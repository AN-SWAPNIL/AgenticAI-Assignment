import type { Workspace } from "./workspace.js";
import type { ConvexBridge } from "./convexBridge.js";
import { api } from "./convexApi.js";
import { DeltaBuffer } from "./deltaBuffer.js";
import { createAgentSession } from "./agentSession.js";
import { safeJson, truncateText } from "./tools/util.js";

/**
 * Per-run executor. The daemon calls processRun() once for each queued run; the function:
 *   1. Atomically claims the run (returns null on already-claimed → caller skips).
 *   2. Loads conversation history (capped) so the agent has multi-turn context.
 *   3. Builds a fresh pi-agent-core Agent and subscribes to its event stream.
 *   4. Streams text deltas to Convex via DeltaBuffer (150ms debounce).
 *   5. Records each tool start/end as both a row in toolExecutions and a timelineEvent,
 *      plus mirrors every event into timelineEvents so the observability panel shows the
 *      full agent loop, not just the user-visible text.
 *   6. Finalizes the run as completed/error.
 *
 * One run is processed at a time; the daemon serializes via a `processing` flag so we
 * never run two agent loops against the same Convex history concurrently.
 */
export interface RunLoopOptions {
  bridge: ConvexBridge;
  workspace: Workspace;
  modelId: string;
  apiKey: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
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
  toolExecutionId?: string;
  persisted: Promise<string>;
}

export async function processRun(
  opts: RunLoopOptions,
  queuedRunId: string,
): Promise<void> {
  const { bridge } = opts;

  const claim = await bridge.mutation(api.ingest.claimRun, {
    conversationId: bridge.conversationId,
    agentToken: bridge.agentToken,
    runId: queuedRunId,
  });
  if (!claim) {
    // Already claimed by an earlier daemon instance, or moved out of "queued" by the
    // sweeper. Either way, nothing to do.
    return;
  }

  const { runToken, userMessageContent } = claim;
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
        // Telemetry must never crash the agent loop; log and move on.
        console.error("[agent] timeline event failed:", err);
      });
  };

  await emitTimeline("agent_start", {
    runId,
    userMessageContent: truncateText(userMessageContent, 4000),
  });

  // Load conversation history *minus* the current user message and the empty assistant
  // placeholder we just created. We then concatenate it into the prompt rather than trying
  // to construct fully-typed AgentMessage objects (pi-agent-core's AssistantMessage shape
  // requires provider/model/usage fields we don't have). This is the same approach try1
  // took and it works fine for chat history of this scale.
  const historyLimit = opts.historyLimit ?? 30;
  const allMessages = await bridge.query(api.conversations.messages, {
    conversationId: bridge.conversationId,
  });
  const priorMessages = [...allMessages]
    .sort((a, b) => a.order - b.order)
    .filter(
      (m) =>
        (m.role === "user" || m.role === "assistant") &&
        m._id !== messageId &&
        m.content.length > 0 &&
        // Drop the just-inserted user message — it's the prompt, not history.
        m.content !== userMessageContent,
    )
    .slice(-historyLimit);

  const session = createAgentSession({
    workspace: opts.workspace,
    modelId: opts.modelId,
    apiKey: opts.apiKey,
    thinkingLevel: opts.thinkingLevel,
  });

  const promptWithHistory = buildPromptWithHistory(priorMessages, userMessageContent);

  const activeToolCalls = new Map<string, ToolCallTracker>();
  const runtimeState: {
    assistantTextFromEvents: string;
    eventError?: string;
  } = {
    assistantTextFromEvents: "",
    eventError: undefined,
  };

  const unsubscribe = session.agent.subscribe((event) => {
    handleAgentEvent(event, {
      bridge,
      runId,
      runToken,
      deltaBuffer,
      activeToolCalls,
      sequence,
      emitTimeline,
      runtimeState,
    });
  });

  let promptError: string | undefined;
  try {
    await session.agent.prompt(promptWithHistory);
  } catch (err) {
    promptError = err instanceof Error ? err.message : String(err);
  } finally {
    unsubscribe?.();
    await deltaBuffer.flush();
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
}

interface EventHandlerCtx {
  bridge: ConvexBridge;
  runId: string;
  runToken: string;
  deltaBuffer: DeltaBuffer;
  activeToolCalls: Map<string, ToolCallTracker>;
  sequence: { next: () => number };
  emitTimeline: (type: string, payload: unknown) => void;
  runtimeState: {
    assistantTextFromEvents: string;
    eventError?: string;
  };
}

function handleAgentEvent(event: unknown, ctx: EventHandlerCtx): void {
  if (!event || typeof event !== "object") return;
  const ev = event as { type?: string; [k: string]: unknown };

  // Always mirror to timeline so the observability panel sees the full agent loop.
  // We trim the payload before sending to keep mutations small.
  ctx.emitTimeline(String(ev.type ?? "unknown"), event);

  if (ev.type === "message_update") {
    const inner = (ev as { assistantMessageEvent?: unknown }).assistantMessageEvent;
    if (inner && typeof inner === "object") {
      const innerEv = inner as { type?: string; delta?: unknown; errorMessage?: unknown };
      if (innerEv.type === "text_delta" && typeof innerEv.delta === "string") {
        ctx.deltaBuffer.push(innerEv.delta);
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
    if (!tracker) {
      // Start was missed (race during reconnect). Skip the finish — observability will
      // still show the timeline event we emitted at the top of this handler.
      return;
    }
    const durationMs = Date.now() - tracker.startedAt;
    const serialized = JSON.stringify(safeJson(result));
    void (async () => {
      let toolExecutionId = tracker.toolExecutionId;
      if (!toolExecutionId) {
        try {
          toolExecutionId = await tracker.persisted;
        } catch {
          // startToolExecution already logged; skip finish mutation if start never persisted.
          return;
        }
      }
      await ctx.bridge.mutation(api.ingest.finishToolExecution, {
        toolExecutionId,
        runToken: ctx.runToken,
        status: isError ? "error" : "success",
        outputText: isError ? undefined : truncateText(serialized),
        errorText: isError ? truncateText(serialized) : undefined,
        durationMs,
      });
    })().catch((err) => console.error("[agent] finishToolExecution failed:", err));
    ctx.activeToolCalls.delete(toolCallId);
    return;
  }
}

function buildPromptWithHistory(
  history: Array<{ role: "user" | "assistant" | "system"; content: string }>,
  prompt: string,
): string {
  if (history.length === 0) return prompt;
  const blocks = history.map((entry) => {
    const role = entry.role === "assistant" ? "ASSISTANT" : "USER";
    return `${role}: ${entry.content}`;
  });
  return [
    "Conversation history:",
    blocks.join("\n\n"),
    "",
    "Current user message:",
    prompt,
  ].join("\n");
}

function makeSequencer(): { next: () => number } {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return n;
    },
  };
}

function extractFinalAssistantResult(messages: unknown): {
  text: string;
  error?: string;
} {
  const empty = { text: "" };
  if (!Array.isArray(messages)) return empty;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as
      | {
          role?: unknown;
          content?: unknown;
          stopReason?: unknown;
          errorMessage?: unknown;
        }
      | undefined;
    if (!message || message.role !== "assistant") continue;
    const text = extractAssistantTextFromContent(message.content);
    const errorMessage =
      typeof message.errorMessage === "string" && message.errorMessage.length > 0
        ? normalizeAgentError(message.errorMessage)
        : undefined;
    if (message.stopReason === "error" || errorMessage) {
      return {
        text,
        error:
          errorMessage ?? "Assistant generation ended with stopReason=error",
      };
    }
    return { text };
  }
  return empty;
}

function extractAssistantTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text"
      ) {
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
      /retry in ([0-9.]+s)/i.exec(flat) ??
      /"retryDelay"\s*:\s*"([^"]+)"/i.exec(flat);
    const retrySuffix = retryMatch?.[1] ? ` Retry after ${retryMatch[1]}.` : "";
    return (
      "Gemini API rate/quota limit reached (429 RESOURCE_EXHAUSTED)." +
      retrySuffix +
      " Check AI Studio rate limits or enable billing."
    );
  }

  return text;
}
