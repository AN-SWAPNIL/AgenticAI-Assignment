import { mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Workspace } from "./workspace.js";
import type { ConvexBridge } from "./convexBridge.js";
import { api } from "./convexApi.js";
import { DeltaBuffer } from "./deltaBuffer.js";
import { createAgentSession } from "./agentSession.js";
import { safeJson, truncateText } from "./tools/util.js";

/**
 * Per-run executor. The daemon calls processRun() once for each queued run; the function:
 *   1. Atomically claims the run (returns null on already-claimed → caller skips).
 *   2. Downloads any image attachments to workspace/uploads/ for bash/read/grep access.
 *   3. Loads conversation history (capped at historyLimit) with optional rolling summary.
 *   4. Builds a fresh pi-agent-core Agent and subscribes to its event stream.
 *   5. Streams text deltas to Convex via DeltaBuffer (150ms debounce).
 *   6. Records each tool start/end as both a row in toolExecutions and a timelineEvent.
 *   7. Retries up to 3× on Gemini 429 rate-limit errors with exponential back-off.
 *   8. Auto-summarizes older history turns when context exceeds SUMMARY_THRESHOLD.
 *   9. Finalizes the run as completed/error.
 */
export interface RunLoopOptions {
  bridge: ConvexBridge;
  workspace: Workspace;
  modelId: string;
  openAiApiKey: string;
  tavilyApiKey?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
  historyLimit?: number;
}

export interface QueuedRun {
  _id: string;
  status: string;
}

interface ToolCallTracker {
  toolName: string;
  inputJson: string;
  startedAt: number;
  sequence: number;
  streamedOutput: boolean;
  toolExecutionId?: string;
  persisted: Promise<string>;
}

// Number of recent turns to keep in the live context window.
const SUMMARY_THRESHOLD = 20;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [5_000, 10_000, 20_000];
const RUN_INTERRUPT_POLL_MS = 200;

class RunInterruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunInterruptedError";
  }
}

/**
 * A content part for multimodal messages. Mirrors the pi-ai ContentPart union.
 * We use `unknown` compatibility so the agent.prompt() call accepts either shape.
 */
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export async function processRun(
  opts: RunLoopOptions,
  queuedRunId: string,
): Promise<void> {
  const { bridge } = opts;
  let claimedRunToken: string | null = null;

  try {
    const claim = await bridge.mutation(api.ingest.claimRun, {
      conversationId: bridge.conversationId,
      agentToken: bridge.agentToken,
      runId: queuedRunId,
    });
    if (!claim) {
      return;
    }

    const {
      runToken,
      userMessageId,
      modelId: claimModelId,
      thinkingLevel: claimThinkingLevel,
      userMessageContent,
      attachmentUrls,
      attachedFiles,
      summaryContext,
    } = claim;
    claimedRunToken = runToken;
    const runId = queuedRunId;

  const messageId = await bridge.mutation(api.ingest.ensureAssistantMessage, {
    runId,
    runToken,
  });

  const sequence = makeSequencer();

  const flushDelta = async (chunk: string) => {
    await bridge.mutation(api.ingest.appendAssistantDelta, {
      runId,
      runToken,
      messageId,
      chunk,
    });
  };
  const deltaBuffer = new DeltaBuffer(flushDelta);

  const flushThinkingDelta = async (chunk: string) => {
    await bridge.mutation(api.ingest.appendThinkingDelta, {
      runId,
      runToken,
      messageId,
      chunk,
    });
  };
  const thinkingDeltaBuffer = new DeltaBuffer(flushThinkingDelta, 0);

  const emitTimeline = (type: string, payload: unknown) => {
    void bridge
      .mutation(api.ingest.appendTimelineEvent, {
        runId,
        runToken,
        sequence: sequence.next(),
        type,
        payloadJson: JSON.stringify(safeJson(payload)),
      })
      .catch((err) => {
        console.error("[agent] timeline event failed:", err);
      });
  };

  await emitTimeline("agent_start", {
    runId,
    userMessageContent: truncateText(userMessageContent, 4000),
    attachmentCount: attachmentUrls.length,
    attachedFileNames: attachedFiles.map((f) => f.name),
  });

  // Download attachments to workspace/uploads/ so bash/read/grep can access them.
  const downloadedPaths: string[] = [];
  if (attachmentUrls.length > 0) {
    try {
      downloadedPaths.push(
        ...(await downloadAttachmentsToWorkspace(opts.workspace.root, attachmentUrls)),
      );
      emitTimeline("attachments_downloaded", { paths: downloadedPaths });
    } catch (err) {
      console.error("[agent] attachment download failed:", err);
    }
  }

  // Load conversation history, capped at historyLimit.
  const historyLimit = opts.historyLimit ?? 30;
  const allMessages = await bridge.query(api.conversations.messages, {
    conversationId: bridge.conversationId,
  });
  const priorMessages = [...allMessages]
    .sort((a, b) => a.order - b.order)
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        m._id !== userMessageId &&
        m._id !== messageId &&
        m.content.length > 0,
    )
    .slice(-historyLimit);

  // Auto-summarize: if we have more history than SUMMARY_THRESHOLD, use a rolling summary
  // for older turns so the context window doesn't blow up on long conversations.
  let activeSummaryContext = summaryContext;
  if (priorMessages.length > SUMMARY_THRESHOLD && !summaryContext) {
    const olderTurns = priorMessages.slice(0, -SUMMARY_THRESHOLD);
    try {
      activeSummaryContext = await generateConversationSummary(olderTurns, opts);
      // Persist so future runs don't re-summarize the same history.
      void bridge
        .mutation(api.ingest.saveSummaryContext, {
          conversationId: bridge.conversationId,
          agentToken: bridge.agentToken,
          summary: activeSummaryContext,
        })
        .catch((err) => console.error("[agent] saveSummaryContext failed:", err));
      emitTimeline("history_summarized", { turnsSummarized: olderTurns.length });
    } catch (err) {
      console.error("[agent] auto-summarize failed:", err);
    }
  }

  const recentHistory =
    priorMessages.length > SUMMARY_THRESHOLD
      ? priorMessages.slice(-SUMMARY_THRESHOLD)
      : priorMessages;

  // activeToolCalls must be created before createAgentSession so the bash onBashChunk
  // callback can close over it and look up toolExecutionId at execution time.
  const activeToolCalls = new Map<string, ToolCallTracker>();

  // Use the modelId from the conversation at run-time (supports mid-session model switching).
  const session = createAgentSession({
    workspace: opts.workspace,
    modelId: claimModelId || opts.modelId,
    openAiApiKey: opts.openAiApiKey,
    tavilyApiKey: opts.tavilyApiKey,
    onQueueFileExport: async ({ path, displayName }) =>
      await bridge.mutation(api.ingest.requestFileExport, {
        runId,
        runToken,
        sequence: sequence.next(),
        path,
        displayName,
      }),
    onBashChunk: (toolCallId, chunk) => {
      const tracker = activeToolCalls.get(toolCallId);
      if (!tracker) return;
      tracker.streamedOutput = true;
      void (async () => {
        try {
          const toolExecutionId = tracker.toolExecutionId ?? (await tracker.persisted);
          if (toolExecutionId) {
            await bridge.mutation(api.ingest.appendToolOutput, {
              toolExecutionId,
              runToken,
              chunk,
            });
          }
        } catch {
          // Telemetry failure — never crash the tool
        }
      })();
    },
    thinkingLevel:
      (claimThinkingLevel as "off" | "minimal" | "low" | "medium" | "high" | undefined) ??
      opts.thinkingLevel,
  });

  // Prepend attached file context so the agent sees it before the user request.
  // Files are already copied to the sandbox by processUploadToSandbox.
  const fileContextNote =
    attachedFiles.length > 0
      ? `[User attached ${attachedFiles.length} file(s) — copied to sandbox uploads/ dir]\n` +
        attachedFiles
          .map((f) => {
            const pathPart = f.sandboxPath ? ` → ${f.sandboxPath}` : "";
            const statusPart = f.status !== "ready" ? ` [still transferring — wait a moment then ls]` : "";
            return `• ${f.name} (${f.contentType})${pathPart}${statusPart}`;
          })
          .join("\n") +
        "\n\n"
      : "";
  const enrichedContent = fileContextNote + userMessageContent;

  // Build multimodal prompt: text + image URLs (if any).
  const promptInput: string | ContentPart[] =
    attachmentUrls.length > 0
      ? [
          { type: "text", text: enrichedContent },
          ...attachmentUrls.map((url) => ({
            type: "image_url" as const,
            image_url: { url },
          })),
        ]
      : buildPromptWithHistory(recentHistory, enrichedContent, activeSummaryContext);

  // For multimodal prompts, prepend history as a leading text part.
  const finalPromptInput = Array.isArray(promptInput)
    ? [
        { type: "text" as const, text: buildHistoryPreamble(recentHistory, activeSummaryContext) },
        ...promptInput,
      ]
    : promptInput;

  const runtimeState: {
    assistantTextFromEvents: string;
    thinkingContent: string;
    eventError?: string;
  } = {
    assistantTextFromEvents: "",
    thinkingContent: "",
    eventError: undefined,
  };

  const unsubscribe = session.agent.subscribe((event) => {
    handleAgentEvent(event, {
      bridge,
      runId,
      runToken: runToken,
      deltaBuffer,
      thinkingDeltaBuffer,
      activeToolCalls,
      sequence,
      emitTimeline,
      runtimeState,
    });
  });

  let promptError: string | undefined;
  try {
    // Retry on 429 rate-limit with exponential back-off.
    let attempt = 0;
    while (true) {
      const stopWatcher = createRunStopWatcher({
        bridge,
        runId,
        pollMs: RUN_INTERRUPT_POLL_MS,
      });

      try {
        const attemptPromise = Array.isArray(finalPromptInput)
          ? session.agent.prompt({
              role: "user",
              content: finalPromptInput,
              timestamp: Date.now(),
            } as any)
          : session.agent.prompt(finalPromptInput as string);
        void attemptPromise.catch(() => undefined);

        await Promise.race([attemptPromise, stopWatcher.promise]);
        break;
      } catch (err) {
        if (err instanceof RunInterruptedError) {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        const isRateLimit = /RESOURCE_EXHAUSTED|429|rate.?limit|quota.?exceeded/i.test(msg);
        if (isRateLimit && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS_MS[attempt] ?? 20_000;
          emitTimeline("agent_retry", { attempt: attempt + 1, delayMs: delay, reason: "rate_limit" });
          await new Promise((r) => setTimeout(r, delay));
          attempt += 1;
          continue;
        }
        throw err;
      } finally {
        stopWatcher.cancel();
      }
    }
  } catch (err) {
    promptError = err instanceof Error ? err.message : String(err);
  } finally {
    unsubscribe?.();
    await deltaBuffer.flush();
    await thinkingDeltaBuffer.flush();
  }

  const assistantResult = extractFinalAssistantResult(session.agent.state.messages);
  const finalAssistantText =
    assistantResult.text || runtimeState.assistantTextFromEvents;
  if (finalAssistantText.length > 0) {
    await bridge.mutation(api.ingest.syncAssistantMessageContent, {
      runId,
      runToken,
      messageId,
      content: finalAssistantText,
    });
  }

  // Persist thinking content if any was produced
  if (runtimeState.thinkingContent.length > 0) {
    await bridge.mutation(api.ingest.syncThinkingContent, {
      runId,
      runToken,
      messageId,
      thinkingContent: runtimeState.thinkingContent,
    }).catch((err) => console.error("[agent] syncThinkingContent failed:", err));
  }

  const finalError = promptError ?? assistantResult.error ?? runtimeState.eventError;
  if (finalError) {
    await emitTimeline("agent_error", { error: finalError });
  } else {
    await emitTimeline("agent_complete", {});
  }

    await bridge.mutation(api.ingest.finalizeRun, {
      runId,
      runToken,
      status: finalError ? "error" : "completed",
      error: finalError,
    });
  } catch (err) {
    if (claimedRunToken) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        await bridge.mutation(api.ingest.finalizeRun, {
          runId: queuedRunId,
          runToken: claimedRunToken,
          status: "error",
          error: truncateText(`Agent runtime crash: ${message}`, 1000),
        });
      } catch {
        // best effort only
      }
    }
    throw err;
  }
}

function createRunStopWatcher(opts: {
  bridge: ConvexBridge;
  runId: string;
  pollMs: number;
}): { promise: Promise<void>; cancel: () => void } {
  let cancelled = false;

  const promise = (async () => {
    while (!cancelled) {
      await new Promise((resolve) => setTimeout(resolve, opts.pollMs));
      if (cancelled) return;

      try {
        const run = await opts.bridge.query(api.conversations.runById, {
          runId: opts.runId,
        });
        if (!run || run.status !== "running") {
          throw new RunInterruptedError(
            run?.error && run.error.trim().length > 0
              ? run.error
              : "Run interrupted by cancel/newer message.",
          );
        }
      } catch (err) {
        if (err instanceof RunInterruptedError) throw err;
        // Transient query issues: keep polling instead of hard-failing the run.
      }
    }
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
  };
}

// ─── attachment download ─────────────────────────────────────────────────────

async function downloadAttachmentsToWorkspace(
  workspaceRoot: string,
  urls: string[],
): Promise<string[]> {
  const uploadsDir = join(workspaceRoot, "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const paths: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        console.warn(`[agent] attachment fetch failed (${response.status}): ${url}`);
        continue;
      }
      // Derive filename from URL or content-disposition header.
      const disposition = response.headers.get("content-disposition") ?? "";
      const nameMatch = /filename[^;=\n]*=['"]?([^'"\n]+)/i.exec(disposition);
      const urlName = basename(new URL(url).pathname) || "attachment";
      const filename = sanitizeFilename(nameMatch?.[1] ?? urlName);
      const dest = join(uploadsDir, filename);

      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const { writeFile } = await import("node:fs/promises");
      await writeFile(dest, buffer);
      paths.push(dest);
    } catch (err) {
      console.warn("[agent] attachment download error:", err);
    }
  }
  return paths;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]/g, "_").slice(0, 120) || "attachment";
}

// ─── auto-summarization ──────────────────────────────────────────────────────

async function generateConversationSummary(
  turns: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  opts: RunLoopOptions,
): Promise<string> {
  const { createAgentSession } = await import("./agentSession.js");
  const summarySession = createAgentSession({
    workspace: opts.workspace,
    modelId: opts.modelId,
    openAiApiKey: opts.openAiApiKey,
    tavilyApiKey: opts.tavilyApiKey,
  });

  const historyText = turns
    .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
    .join("\n\n");

  const summaryPrompt = [
    "Summarize the following conversation history in 2-4 sentences. Capture the key topics discussed, any decisions made, and any files or code produced. Be factual and concise — this summary will be injected as context for future turns.",
    "",
    historyText,
  ].join("\n");

  let summary = "";
  const unsub = summarySession.agent.subscribe((event) => {
    const ev = event as { type?: string; assistantMessageEvent?: { type?: string; delta?: string } };
    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
      summary += ev.assistantMessageEvent.delta ?? "";
    }
  });

  try {
    await summarySession.agent.prompt(summaryPrompt);
  } finally {
    unsub?.();
  }

  return summary.trim() || historyText.slice(0, 2000);
}

// ─── event handling ──────────────────────────────────────────────────────────

interface EventHandlerCtx {
  bridge: ConvexBridge;
  runId: string;
  runToken: string;
  deltaBuffer: DeltaBuffer;
  thinkingDeltaBuffer: DeltaBuffer;
  activeToolCalls: Map<string, ToolCallTracker>;
  sequence: { next: () => number };
  emitTimeline: (type: string, payload: unknown) => void;
  runtimeState: {
    assistantTextFromEvents: string;
    thinkingContent: string;
    eventError?: string;
  };
}

function handleAgentEvent(event: unknown, ctx: EventHandlerCtx): void {
  if (!event || typeof event !== "object") return;
  const ev = event as { type?: string; [k: string]: unknown };

  ctx.emitTimeline(String(ev.type ?? "unknown"), event);

  if (ev.type === "message_update") {
    const inner = (ev as { assistantMessageEvent?: unknown }).assistantMessageEvent;
    if (inner && typeof inner === "object") {
      const innerEv = inner as { type?: string; delta?: unknown; errorMessage?: unknown };
      if (innerEv.type === "text_delta" && typeof innerEv.delta === "string") {
        ctx.deltaBuffer.push(innerEv.delta);
      }
      if (innerEv.type === "thinking_delta" && typeof innerEv.delta === "string") {
        ctx.runtimeState.thinkingContent += innerEv.delta;
        ctx.thinkingDeltaBuffer.push(innerEv.delta);
      }
      if (innerEv.type === "error" && typeof innerEv.errorMessage === "string") {
        ctx.runtimeState.eventError = normalizeAgentError(innerEv.errorMessage);
      }
    }
    return;
  }

  if (ev.type === "message_end") {
    const message = (ev as { message?: unknown }).message;
    if (message && typeof message === "object") {
      const assistant = message as {
        role?: unknown;
        content?: unknown;
        stopReason?: unknown;
        errorMessage?: unknown;
      };
      if (assistant.role === "assistant") {
        const assistantText = extractAssistantTextFromContent(assistant.content);
        if (assistantText.length > 0) {
          ctx.runtimeState.assistantTextFromEvents = assistantText;
        }
        if (assistant.stopReason === "error") {
          const errorMessage =
            typeof assistant.errorMessage === "string" && assistant.errorMessage.length > 0
              ? assistant.errorMessage
              : "Assistant generation ended with stopReason=error";
          ctx.runtimeState.eventError = normalizeAgentError(errorMessage);
        }
      }
    }
    return;
  }

  if (ev.type === "tool_execution_start") {
    const toolCallId = String(ev.toolCallId ?? "");
    const toolName = String(ev.toolName ?? "unknown");
    const inputJson = JSON.stringify(safeJson(ev.args));
    const seq = ctx.sequence.next();
    const startedAt = Date.now();
    const tracker: ToolCallTracker = {
      toolName,
      inputJson,
      startedAt,
      sequence: seq,
      streamedOutput: false,
      persisted: Promise.resolve(""),
    };
    tracker.persisted = ctx.bridge
      .mutation(api.ingest.startToolExecution, {
        runId: ctx.runId,
        runToken: ctx.runToken,
        sequence: seq,
        toolName,
        inputJson,
      })
      .then((toolExecutionId) => {
        tracker.toolExecutionId = toolExecutionId;
        return toolExecutionId;
      });
    ctx.activeToolCalls.set(toolCallId, tracker);
    void tracker.persisted.catch((err) =>
      console.error("[agent] startToolExecution failed:", err),
    );
    return;
  }

  if (ev.type === "tool_execution_end") {
    const toolCallId = String(ev.toolCallId ?? "");
    const isError = Boolean((ev as { isError?: unknown }).isError);
    const result = (ev as { result?: unknown }).result;
    const tracker = ctx.activeToolCalls.get(toolCallId);
    if (!tracker) return;
    const durationMs = Date.now() - tracker.startedAt;
    const serialized = JSON.stringify(safeJson(result));
    void (async () => {
      let toolExecutionId = tracker.toolExecutionId;
      if (!toolExecutionId) {
        try {
          toolExecutionId = await tracker.persisted;
        } catch {
          return;
        }
      }
      const finishArgs: {
        toolExecutionId: string;
        runToken: string;
        status: "success" | "error";
        durationMs: number;
        outputText?: string;
        errorText?: string;
      } = {
        toolExecutionId,
        runToken: ctx.runToken,
        status: isError ? "error" : "success",
        durationMs,
      };
      if (isError) {
        finishArgs.errorText = truncateText(serialized);
      } else if (!tracker.streamedOutput) {
        // Preserve live tool output for streamed tools (bash/shell).
        finishArgs.outputText = truncateText(serialized);
      }
      await ctx.bridge.mutation(api.ingest.finishToolExecution, finishArgs);
    })().catch((err) => console.error("[agent] finishToolExecution failed:", err));
    ctx.activeToolCalls.delete(toolCallId);
    return;
  }
}

// ─── prompt helpers ──────────────────────────────────────────────────────────

function buildHistoryPreamble(
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  summaryContext?: string,
): string {
  const parts: string[] = [];
  if (summaryContext) {
    parts.push(`[Earlier conversation summary]\n${summaryContext}`);
  }
  if (history.length > 0) {
    parts.push("Conversation history:");
    parts.push(...history.map((m) => `${m.role === "assistant" ? "ASSISTANT" : "USER"}: ${m.content}`));
  }
  return parts.join("\n\n");
}

function buildPromptWithHistory(
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  prompt: string,
  summaryContext?: string,
): string {
  const parts: string[] = [];
  if (summaryContext) {
    parts.push(`[Earlier conversation summary]\n${summaryContext}`);
  }
  if (history.length > 0) {
    parts.push("Conversation history:");
    parts.push(...history.map((m) => `${m.role === "assistant" ? "ASSISTANT" : "USER"}: ${m.content}`));
    parts.push("");
  }
  parts.push("Current user message:");
  parts.push(prompt);
  return parts.join("\n");
}

function makeSequencer(): { next: () => number } {
  let n = 0;
  return { next: () => { n += 1; return n; } };
}

function extractFinalAssistantResult(messages: unknown): { text: string; error?: string } {
  const empty = { text: "" };
  if (!Array.isArray(messages)) return empty;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as
      | { role?: unknown; content?: unknown; stopReason?: unknown; errorMessage?: unknown }
      | undefined;
    if (!message || message.role !== "assistant") continue;
    const text = extractAssistantTextFromContent(message.content);
    const errorMessage =
      typeof message.errorMessage === "string" && message.errorMessage.length > 0
        ? normalizeAgentError(message.errorMessage)
        : undefined;
    if (message.stopReason === "error" || errorMessage) {
      return { text, error: errorMessage ?? "Assistant generation ended with stopReason=error" };
    }
    return { text };
  }
  return empty;
}

function extractAssistantTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
        return String((block as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .join("");
}

function normalizeAgentError(raw: string): string {
  const text = truncateText(raw, 4000);
  const flat = text.replace(/\s+/g, " ");
  const isRateLimited =
    /RESOURCE_EXHAUSTED/i.test(flat) ||
    /\brate limit\b/i.test(flat) ||
    /\bquota exceeded\b/i.test(flat) ||
    /"code"\s*:\s*429/.test(flat);

  if (isRateLimited) {
    const retryMatch =
      /retry in ([0-9.]+s)/i.exec(flat) ?? /"retryDelay"\s*:\s*"([^"]+)"/i.exec(flat);
    const retrySuffix = retryMatch?.[1] ? ` Retry after ${retryMatch[1]}.` : "";
    return (
      "Gemini API rate/quota limit reached (429 RESOURCE_EXHAUSTED)." +
      retrySuffix +
      " Check AI Studio rate limits or enable billing."
    );
  }

  return text;
}
