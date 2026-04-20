import { v } from "convex/values";
import { internal } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { fileBasename, sanitizeDisplayName, tokensMatch } from "./lib";

/**
 * VM-facing surface. Every function here is called by the in-VM agent daemon via a Convex
 * HTTP/WebSocket client. Authentication is via two shared secrets:
 *
 *   agentToken — conversation-scoped; generated on provision, baked into the VM env.
 *   runToken   — run-scoped; generated when sendMessage enqueues a run, returned to the
 *                daemon on claimRun.
 *
 * We verify these manually inside each handler rather than via Convex auth, because the
 * daemon is not a logged-in user — it's trusted code running in a known VM. The tokens
 * bind "this VM may only write to this conversation's runs".
 */

async function requireConversation(
  ctx: { db: { get: (id: Id<"conversations">) => Promise<Doc<"conversations"> | null> } },
  conversationId: Id<"conversations">,
  agentToken: string,
): Promise<Doc<"conversations">> {
  const conversation = await ctx.db.get(conversationId);
  if (!conversation || conversation.status === "deleted") {
    throw new Error("Conversation not found");
  }
  if (!tokensMatch(conversation.agentToken, agentToken)) {
    throw new Error("Invalid agent token");
  }
  return conversation;
}

async function requireRun(
  ctx: { db: { get: (id: Id<"runs">) => Promise<Doc<"runs"> | null> } },
  runId: Id<"runs">,
  runToken: string,
): Promise<Doc<"runs">> {
  const run = await ctx.db.get(runId);
  if (!run) {
    throw new Error("Run not found");
  }
  if (!tokensMatch(run.runToken, runToken)) {
    throw new Error("Invalid run token");
  }
  return run;
}

function canAcceptRuntimeUpdates(run: Doc<"runs">): boolean {
  return run.status === "running";
}

const DEFAULT_WORKSPACE_DIR = "/home/daytona/workspace";

function normalizeExportPath(workspaceDir: string | undefined, rawPath: string): string {
  const workspaceRoot = (workspaceDir || DEFAULT_WORKSPACE_DIR).replace(/\/+$/, "");
  const normalizedInput = rawPath.replace(/\\/g, "/").replace(/\s+/g, " ").trim();
  if (!normalizedInput) {
    throw new Error("Path cannot be empty");
  }
  if (normalizedInput.includes("\u0000")) {
    throw new Error("Path contains invalid characters");
  }

  const pathSegments = normalizedInput
    .replace(/^\.?\//, "")
    .split("/")
    .filter(Boolean);
  if (pathSegments.length === 0) {
    throw new Error("Path must point to a file");
  }
  if (pathSegments.some((segment) => segment === "..")) {
    throw new Error("Path traversal is not allowed");
  }

  const absolutePath = normalizedInput.startsWith("/")
    ? `/${pathSegments.join("/")}`
    : `${workspaceRoot}/${pathSegments.join("/")}`;

  if (absolutePath === workspaceRoot || !absolutePath.startsWith(`${workspaceRoot}/`)) {
    throw new Error(`Path must stay inside workspace (${workspaceRoot})`);
  }
  return absolutePath;
}

// ─── daemon subscription target ─────────────────────────────────────────────

/**
 * Returns the oldest queued run for this conversation, or null. The daemon subscribes to
 * this query via WebSocket; Convex pushes updates automatically whenever sendMessage
 * enqueues a new run. Authenticated by agentToken so a rogue client can't probe other
 * conversations' queues.
 */
export const nextQueuedRun = query({
  args: {
    conversationId: v.id("conversations"),
    agentToken: v.string(),
  },
  handler: async (ctx, { conversationId, agentToken }): Promise<Doc<"runs"> | null> => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || !tokensMatch(conversation.agentToken, agentToken)) {
      // Return null (not throw) so a brief auth mismatch during provisioning doesn't spam
      // subscription errors. The daemon will retry with correct credentials.
      return null;
    }
    return await ctx.db
      .query("runs")
      .withIndex("by_conv_status", (q) =>
        q.eq("conversationId", conversationId).eq("status", "queued"),
      )
      .order("asc")
      .first();
  },
});

// ─── heartbeat ──────────────────────────────────────────────────────────────

export const heartbeat = mutation({
  args: {
    conversationId: v.id("conversations"),
    agentToken: v.string(),
  },
  handler: async (ctx, { conversationId, agentToken }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.status === "deleted") {
      // Stale/orphan daemon from an old deployment. Ignore silently so dev logs
      // aren't flooded with uncaught errors every heartbeat tick.
      return { accepted: false as const };
    }
    if (!tokensMatch(conversation.agentToken, agentToken)) {
      return { accepted: false as const };
    }
    await ctx.db.patch(conversationId, { lastHeartbeatAt: Date.now() });
    return { accepted: true as const };
  },
});

// ─── run lifecycle ──────────────────────────────────────────────────────────

/**
 * Atomically claim a queued run. Returns null if the run is no longer queued (e.g. already
 * claimed by a restarted daemon or moved to error by the orphan sweeper).
 */
export const claimRun = mutation({
  args: {
    conversationId: v.id("conversations"),
    agentToken: v.string(),
    runId: v.id("runs"),
  },
  handler: async (
    ctx,
    { conversationId, agentToken, runId },
  ): Promise<{
    runToken: string;
    userMessageId: Id<"messages">;
    modelId: string;
    userMessageContent: string;
    attachmentUrls: string[];
    attachedFiles: Array<{ name: string; contentType: string; sandboxPath: string | null; status: string }>;
    summaryContext: string | undefined;
  } | null> => {
    await requireConversation(ctx, conversationId, agentToken);
    const run = await ctx.db.get(runId);
    if (!run || run.conversationId !== conversationId) {
      return null;
    }
    if (run.status !== "queued") {
      return null;
    }

    const userMessage = await ctx.db.get(run.userMessageId);
    if (!userMessage) {
      throw new Error("User message missing for run");
    }

    // Resolve session files → image URLs for multimodal + metadata for all files.
    const attachmentUrls: string[] = [];
    const attachedFiles: Array<{ name: string; contentType: string; sandboxPath: string | null; status: string }> = [];
    if (userMessage.sessionFileIds && userMessage.sessionFileIds.length > 0) {
      const sessionFiles = await Promise.all(
        userMessage.sessionFileIds.map((id) => ctx.db.get(id)),
      );
      for (const sf of sessionFiles) {
        if (!sf) continue;
        attachedFiles.push({
          name: sf.displayName,
          contentType: sf.contentType ?? "application/octet-stream",
          sandboxPath: sf.sandboxPath ?? null,
          status: sf.status,
        });
        if (sf.storageId && sf.contentType?.startsWith("image/")) {
          const url = await ctx.storage.getUrl(sf.storageId);
          if (url) attachmentUrls.push(url);
        }
      }
    }

    // Pass the conversation's rolling summary for long-context memory.
    const conversation = await ctx.db.get(conversationId);
    const summaryContext = conversation?.summaryContext;

    await ctx.db.patch(runId, {
      status: "running",
      startedAt: Date.now(),
    });
    await ctx.db.patch(conversationId, {
      status: "running",
      updatedAt: Date.now(),
    });

    return {
      runToken: run.runToken,
      userMessageId: run.userMessageId,
      modelId: conversation?.modelId ?? "gemini-2.5-flash",
      userMessageContent: userMessage.content,
      attachmentUrls,
      attachedFiles,
      summaryContext,
    };
  },
});

export const ensureAssistantMessage = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
  },
  handler: async (ctx, { runId, runToken }): Promise<Id<"messages">> => {
    const run = await requireRun(ctx, runId, runToken);
    if (run.assistantMessageId) {
      return run.assistantMessageId;
    }

    const priorMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_order", (q) => q.eq("conversationId", run.conversationId))
      .collect();
    const nextOrder = priorMessages.length;

    const assistantMessageId = await ctx.db.insert("messages", {
      conversationId: run.conversationId,
      runId,
      role: "assistant",
      content: "",
      status: "pending",
      order: nextOrder,
      createdAt: Date.now(),
    });
    await ctx.db.patch(runId, { assistantMessageId });
    return assistantMessageId;
  },
});

export const appendAssistantDelta = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
    messageId: v.id("messages"),
    chunk: v.string(),
  },
  handler: async (ctx, { runId, runToken, messageId, chunk }) => {
    const run = await requireRun(ctx, runId, runToken);
    if (!canAcceptRuntimeUpdates(run)) {
      return { accepted: false as const };
    }
    const message = await ctx.db.get(messageId);
    if (!message || message.runId !== runId) {
      throw new Error("Message does not belong to this run");
    }
    await ctx.db.patch(messageId, {
      content: message.content + chunk,
      status: "streaming",
    });
    await ctx.db.patch(run.conversationId, { updatedAt: Date.now() });
    return { accepted: true as const };
  },
});

export const syncAssistantMessageContent = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, { runId, runToken, messageId, content }) => {
    const run = await requireRun(ctx, runId, runToken);
    if (!canAcceptRuntimeUpdates(run)) {
      return { accepted: false as const };
    }
    const message = await ctx.db.get(messageId);
    if (!message || message.runId !== runId) {
      throw new Error("Message does not belong to this run");
    }
    await ctx.db.patch(messageId, {
      content,
      status: "streaming",
    });
    await ctx.db.patch(run.conversationId, { updatedAt: Date.now() });
    return { accepted: true as const };
  },
});

export const syncThinkingContent = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
    messageId: v.id("messages"),
    thinkingContent: v.string(),
  },
  handler: async (ctx, { runId, runToken, messageId, thinkingContent }) => {
    const run = await requireRun(ctx, runId, runToken);
    if (!canAcceptRuntimeUpdates(run)) {
      return { accepted: false as const };
    }
    await ctx.db.patch(messageId, { thinkingContent });
    return { accepted: true as const };
  },
});

export const startToolExecution = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
    sequence: v.number(),
    toolName: v.string(),
    inputJson: v.string(),
  },
  handler: async (
    ctx,
    { runId, runToken, sequence, toolName, inputJson },
  ): Promise<Id<"toolExecutions">> => {
    const run = await requireRun(ctx, runId, runToken);
    if (!canAcceptRuntimeUpdates(run)) {
      throw new Error("Run is no longer active");
    }
    return await ctx.db.insert("toolExecutions", {
      conversationId: run.conversationId,
      runId,
      sequence,
      toolName,
      inputJson,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const finishToolExecution = mutation({
  args: {
    toolExecutionId: v.id("toolExecutions"),
    runToken: v.string(),
    status: v.union(v.literal("success"), v.literal("error")),
    outputText: v.optional(v.string()),
    errorText: v.optional(v.string()),
    durationMs: v.number(),
  },
  handler: async (
    ctx,
    { toolExecutionId, runToken, status, outputText, errorText, durationMs },
  ) => {
    const record = await ctx.db.get(toolExecutionId);
    if (!record) throw new Error("Tool execution not found");
    const run = await requireRun(ctx, record.runId, runToken);
    if (!canAcceptRuntimeUpdates(run)) {
      return { accepted: false as const };
    }
    await ctx.db.patch(toolExecutionId, {
      status,
      outputText,
      errorText,
      durationMs,
      completedAt: Date.now(),
    });
    return { accepted: true as const };
  },
});

export const appendTimelineEvent = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
    sequence: v.number(),
    type: v.string(),
    payloadJson: v.string(),
  },
  handler: async (ctx, { runId, runToken, sequence, type, payloadJson }) => {
    const run = await requireRun(ctx, runId, runToken);
    if (!canAcceptRuntimeUpdates(run)) {
      return { accepted: false as const };
    }
    await ctx.db.insert("timelineEvents", {
      conversationId: run.conversationId,
      runId,
      sequence,
      type,
      payloadJson,
      createdAt: Date.now(),
    });
    return { accepted: true as const };
  },
});

export const finalizeRun = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
    status: v.union(v.literal("completed"), v.literal("error")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { runId, runToken, status, error }) => {
    const run = await requireRun(ctx, runId, runToken);
    if (run.status === "completed" || run.status === "error") {
      return { accepted: false as const };
    }
    const now = Date.now();

    await ctx.db.patch(runId, {
      status,
      error,
      completedAt: now,
    });

    if (run.assistantMessageId) {
      const assistantPatch: {
        status: "completed" | "error";
        content?: string;
      } = {
        status: status === "completed" ? "completed" : "error",
      };
      if (status === "error" && error) {
        assistantPatch.content = error;
      }
      await ctx.db.patch(run.assistantMessageId, assistantPatch);
    }

    // Always return the conversation to "idle" after a run finishes so the user can
    // immediately send another message. Daemon/orchestrator faults are what should push
    // conversation.status to "error" (those are handled in orchestrator actions).
    await ctx.db.patch(run.conversationId, {
      status: "idle",
      lastError: status === "error" ? error : undefined,
      updatedAt: now,
    });
    return { accepted: true as const };
  },
});

/**
 * User-initiated stop. Marks the active run as error/cancelled and returns the conversation
 * to idle so the user can send another message immediately. The daemon will eventually
 * try to finalizeRun and will overwrite — that's fine, we just want the UI unblocked.
 */
export const cancelRun = mutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    if (run.status === "completed" || run.status === "error") return; // already done
    const now = Date.now();
    await ctx.db.patch(runId, { status: "error", error: "Cancelled by user", completedAt: now });
    if (run.assistantMessageId) {
      await ctx.db.patch(run.assistantMessageId, { status: "completed", content: "[Cancelled]" });
    }
    await ctx.db.patch(run.conversationId, { status: "idle", updatedAt: now });
    return { accepted: true as const };
  },
});

/**
 * Stream live bash/tool output chunks to the tool execution record.
 * The frontend subscribes reactively — each appended chunk triggers a UI update.
 */
export const appendToolOutput = mutation({
  args: {
    toolExecutionId: v.id("toolExecutions"),
    runToken: v.string(),
    chunk: v.string(),
  },
  handler: async (ctx, { toolExecutionId, runToken, chunk }) => {
    const record = await ctx.db.get(toolExecutionId);
    if (!record) throw new Error("Tool execution not found");
    const run = await requireRun(ctx, record.runId, runToken);
    if (!canAcceptRuntimeUpdates(run)) {
      return { accepted: false as const };
    }
    await ctx.db.patch(toolExecutionId, {
      outputText: (record.outputText ?? "") + chunk,
    });
    return { accepted: true as const };
  },
});

/** Persist the rolling conversation summary for long-context memory (called from daemon). */
export const saveSummaryContext = mutation({
  args: {
    conversationId: v.id("conversations"),
    agentToken: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, { conversationId, agentToken, summary }) => {
    await requireConversation(ctx, conversationId, agentToken);
    await ctx.db.patch(conversationId, { summaryContext: summary, updatedAt: Date.now() });
  },
});

/** Force a stuck run to error state (called from sweeper when heartbeat times out). */
export const forceErrorRun = internalMutation({
  args: { runId: v.id("runs"), error: v.string() },
  handler: async (ctx, { runId, error }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status === "completed" || run.status === "error") return;
    const now = Date.now();
    await ctx.db.patch(runId, { status: "error", error, completedAt: now });
    if (run.assistantMessageId) {
      await ctx.db.patch(run.assistantMessageId, { status: "error" });
    }
  },
});

export const requestFileExport = mutation({
  args: {
    runId: v.id("runs"),
    runToken: v.string(),
    path: v.string(),
    displayName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { runId, runToken, path, displayName },
  ): Promise<{ sessionFileId: Id<"sessionFiles"> }> => {
    const run = await requireRun(ctx, runId, runToken);
    const conversation = await ctx.db.get(run.conversationId);
    if (!conversation || conversation.status === "deleted") {
      throw new Error("Conversation not found");
    }

    const sandboxPath = normalizeExportPath(conversation.workspaceDir, path);
    const now = Date.now();
    const preferredName = displayName?.trim() || fileBasename(sandboxPath);
    const sessionFileId = await ctx.db.insert("sessionFiles", {
      conversationId: run.conversationId,
      runId,
      direction: "download",
      source: "agent",
      status: "queued",
      displayName: sanitizeDisplayName(preferredName),
      sandboxPath,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.fileTransfers.processExportToStorage, {
      sessionFileId,
    });

    return { sessionFileId };
  },
});
