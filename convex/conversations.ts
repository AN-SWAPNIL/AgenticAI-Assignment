import { v } from "convex/values";
import { api } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import {
  defaultConversationTitle,
  deriveAutoTitleFromUserMessage,
  generateToken,
} from "./lib";

/**
 * Public API for the control plane. The UI calls only these queries + mutations.
 * All writes that originate from the in-VM daemon go through convex/ingest.ts.
 */

// ─── queries ────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx): Promise<Doc<"conversations">[]> => {
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_updatedAt")
      .order("desc")
      .collect();
    return rows.filter((r) => r.status !== "deleted");
  },
});

export const get = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<Doc<"conversations"> | null> => {
    const row = await ctx.db.get(conversationId);
    return row && row.status !== "deleted" ? row : null;
  },
});

export const messages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<Doc<"messages">[]> => {
    return ctx.db
      .query("messages")
      .withIndex("by_conversation_order", (q) => q.eq("conversationId", conversationId))
      .collect();
  },
});

/**
 * Most recent run (claimed, running, completed, or error) for the observability panel.
 */
export const latestRun = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<Doc<"runs"> | null> => {
    return await ctx.db
      .query("runs")
      .withIndex("by_conv_createdAt", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .first();
  },
});

/**
 * Latest run that is meaningful for telemetry. If the newest run is still queued and has no
 * events yet, fall back to the most recent non-queued run so observability panels don't
 * appear to "blank out" between turns.
 */
export const latestObservableRun = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<Doc<"runs"> | null> => {
    const runs = ctx.db
      .query("runs")
      .withIndex("by_conv_createdAt", (q) => q.eq("conversationId", conversationId))
      .order("desc");

    let fallback: Doc<"runs"> | null = null;
    for await (const run of runs) {
      if (!fallback) fallback = run;
      if (run.status !== "queued") return run;
    }
    return fallback;
  },
});

export const toolExecutions = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"toolExecutions">[]> => {
    return ctx.db
      .query("toolExecutions")
      .withIndex("by_run_sequence", (q) => q.eq("runId", runId))
      .collect();
  },
});

/**
 * Conversation-wide tool history for inline rendering inside chat bubbles.
 */
export const toolExecutionsForConversation = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { conversationId, limit }): Promise<Doc<"toolExecutions">[]> => {
    const bounded = Math.min(1000, Math.max(1, limit ?? 400));
    const rows = await ctx.db
      .query("toolExecutions")
      .withIndex("by_conversationId_and_startedAt", (q) =>
        q.eq("conversationId", conversationId),
      )
      .order("desc")
      .take(bounded);
    return rows.reverse();
  },
});

export const timelineEvents = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"timelineEvents">[]> => {
    return ctx.db
      .query("timelineEvents")
      .withIndex("by_run_sequence", (q) => q.eq("runId", runId))
      .collect();
  },
});

// ─── user-facing mutations ──────────────────────────────────────────────────

export const create = mutation({
  args: { title: v.optional(v.string()) },
  handler: async (ctx, { title }): Promise<{ conversationId: Id<"conversations"> }> => {
    const now = Date.now();
    const cleanedTitle = title?.trim();
    const conversationId = await ctx.db.insert("conversations", {
      title: cleanedTitle || defaultConversationTitle(),
      titleMode: cleanedTitle ? "manual" : "default",
      status: "provisioning",
      agentToken: generateToken(),
      createdAt: now,
      updatedAt: now,
    });
    // Client immediately calls orchestrator.provisionConversation to kick off the VM.
    return { conversationId };
  },
});

export const rename = mutation({
  args: { conversationId: v.id("conversations"), title: v.string() },
  handler: async (ctx, { conversationId, title }) => {
    await ctx.db.patch(conversationId, {
      title: title.trim() || defaultConversationTitle(),
      titleMode: "manual",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Append a user message and enqueue a run. The in-VM daemon picks up the queued run via
 * its subscription to ingest.nextQueuedRun — no action call needed from the control plane.
 */
export const sendMessage = mutation({
  args: { conversationId: v.id("conversations"), content: v.string() },
  handler: async (
    ctx,
    { conversationId, content },
  ): Promise<{ runId: Id<"runs">; userMessageId: Id<"messages"> }> => {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("Message cannot be empty");
    }
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.status === "deleted") {
      throw new Error("Conversation not found");
    }

    const priorMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_order", (q) => q.eq("conversationId", conversationId))
      .collect();
    const nextOrder = priorMessages.length;

    const now = Date.now();
    const hasPriorUserMessage = priorMessages.some((message) => message.role === "user");

    const userMessageId = await ctx.db.insert("messages", {
      conversationId,
      role: "user",
      content: trimmed,
      status: "completed",
      order: nextOrder,
      createdAt: now,
    });

    const runId = await ctx.db.insert("runs", {
      conversationId,
      userMessageId,
      status: "queued",
      runToken: generateToken(),
      createdAt: now,
    });

    const patch: {
      updatedAt: number;
      title?: string;
      titleMode?: "auto";
    } = { updatedAt: now };

    if (!hasPriorUserMessage && conversation.titleMode !== "manual") {
      patch.title = deriveAutoTitleFromUserMessage(trimmed);
      patch.titleMode = "auto";
    }

    await ctx.db.patch(conversationId, patch);

    return { runId, userMessageId };
  },
});

/**
 * Soft-delete the conversation and schedule Daytona teardown via an action.
 */
export const remove = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const row = await ctx.db.get(conversationId);
    if (!row) return;
    await ctx.db.patch(conversationId, {
      status: "deleted",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, api.orchestrator.deleteConversationSandbox, {
      conversationId,
    });
  },
});

/**
 * UI-triggered daemon revival. Used when the heartbeat has been stale for too long.
 */
export const revive = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    await ctx.scheduler.runAfter(0, api.orchestrator.reviveDaemonIfDead, {
      conversationId,
    });
  },
});

// ─── internal mutations (invoked from orchestrator actions) ────────────────

/**
 * Control-plane-internal patch. Callable only from orchestrator actions (not from the VM,
 * not from the UI). No token required because the caller is trusted Convex server code.
 */
/**
 * Read the raw conversation row (including soft-deleted) for orchestrator teardown. Public
 * `get()` filters out deleted rows so we can't fetch the sandboxId from there during cleanup.
 */
export const rawForOrchestrator = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<Doc<"conversations"> | null> => {
    return await ctx.db.get(conversationId);
  },
});

export const patchForOrchestrator = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    patch: v.object({
      status: v.optional(
        v.union(
          v.literal("provisioning"),
          v.literal("idle"),
          v.literal("running"),
          v.literal("error"),
          v.literal("deleted"),
        ),
      ),
      sandboxId: v.optional(v.string()),
      sessionId: v.optional(v.string()),
      workspaceDir: v.optional(v.string()),
      runtimeDir: v.optional(v.string()),
      runtimeVersion: v.optional(v.string()),
      lastError: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { conversationId, patch }) => {
    await ctx.db.patch(conversationId, { ...patch, updatedAt: Date.now() });
  },
});
