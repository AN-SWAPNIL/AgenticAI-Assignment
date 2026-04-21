import { v } from "convex/values";
import { api } from "./_generated/api";
import { type Doc, type Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  defaultConversationTitle,
  deriveAutoTitleFromUserMessage,
  generateToken,
} from "./lib";

/**
 * Public API for the control plane. The UI calls only these queries + mutations.
 * All writes that originate from the in-VM daemon go through convex/ingest.ts.
 */

// ─── shared helpers ──────────────────────────────────────────────────────────

type SessionFileView = Doc<"sessionFiles"> & { downloadUrl: string | null };

/** Resolve session file IDs to enriched records with signed download URLs. */
async function resolveSessionFiles(
  ctx: QueryCtx | MutationCtx,
  ids: Id<"sessionFiles">[],
): Promise<SessionFileView[]> {
  const results = await Promise.all(
    ids.map(async (id) => {
      const sf = await ctx.db.get(id);
      if (!sf) return null;
      const downloadUrl = sf.storageId ? await ctx.storage.getUrl(sf.storageId) : null;
      return { ...sf, downloadUrl } as SessionFileView;
    }),
  );
  return results.filter((r): r is SessionFileView => r !== null);
}

/**
 * New user turn interrupts older in-flight runs for the same conversation.
 * This keeps the UX responsive and prevents stale runs from streaming forever.
 */
async function supersedeInFlightRuns(
  ctx: MutationCtx,
  conversationId: Id<"conversations">,
  now: number,
): Promise<boolean> {
  const statuses: Array<Doc<"runs">["status"]> = ["queued", "claimed", "running"];
  let supersededAny = false;

  for (const status of statuses) {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_conv_status", (q) =>
        q.eq("conversationId", conversationId).eq("status", status),
      )
      .collect();

    for (const run of runs) {
      supersededAny = true;
      await ctx.db.patch(run._id, {
        status: "error",
        error: "Superseded by a newer user message",
        completedAt: now,
      });

      if (run.assistantMessageId) {
        const assistant = await ctx.db.get(run.assistantMessageId);
        if (assistant) {
          await ctx.db.patch(run.assistantMessageId, {
            status: "completed",
            content:
              assistant.content.trim().length > 0
                ? assistant.content
                : "[Superseded by newer message]",
          });
        }
      }

      const tools = await ctx.db
        .query("toolExecutions")
        .withIndex("by_run_sequence", (q) => q.eq("runId", run._id))
        .collect();
      for (const tool of tools) {
        if (tool.status !== "running") continue;
        await ctx.db.patch(tool._id, {
          status: "error",
          errorText: "Superseded by newer message",
          completedAt: now,
          durationMs: Math.max(0, now - tool.startedAt),
        });
      }
    }
  }

  return supersededAny;
}

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

export type MessageView = Doc<"messages"> & { sessionFiles: SessionFileView[] };

const enrichMessage = async (ctx: QueryCtx | MutationCtx, m: Doc<"messages">): Promise<MessageView> => ({
  ...m,
  sessionFiles: m.sessionFileIds ? await resolveSessionFiles(ctx, m.sessionFileIds) : [],
});

export const messages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<MessageView[]> => {
    const rows = await ctx.db
      .query("messages")
      .withIndex("by_conversation_order", (q) => q.eq("conversationId", conversationId))
      .take(500);
    return Promise.all(rows.map((m) => enrichMessage(ctx, m)));
  },
});

/** Full-text search within a conversation's messages. */
export const searchMessages = query({
  args: { conversationId: v.id("conversations"), q: v.string() },
  handler: async (ctx, { conversationId, q }): Promise<MessageView[]> => {
    if (!q.trim()) return [];
    const rows = await ctx.db
      .query("messages")
      .withSearchIndex("search_content", (s) =>
        s.search("content", q).eq("conversationId", conversationId),
      )
      .take(20);
    return Promise.all(rows.map((m) => enrichMessage(ctx, m)));
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

/** Fetch a specific run row by id (used for selecting timeline from a chat response). */
export const runById = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }): Promise<Doc<"runs"> | null> => {
    return await ctx.db.get(runId);
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

/**
 * Conversation-wide timeline stream for rendering ordered assistant phases in chat bubbles.
 */
export const timelineEventsForConversation = query({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { conversationId, limit }): Promise<Doc<"timelineEvents">[]> => {
    const bounded = Math.min(4000, Math.max(1, limit ?? 2000));
    const rows = await ctx.db
      .query("timelineEvents")
      .withIndex("by_conversationId_and_createdAt", (q) => q.eq("conversationId", conversationId))
      .order("desc")
      .take(bounded);
    return rows.reverse();
  },
});

// ─── user-facing mutations ──────────────────────────────────────────────────

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    modelId: v.optional(v.string()),
  },
  handler: async (ctx, { title, modelId }): Promise<{ conversationId: Id<"conversations"> }> => {
    const now = Date.now();
    const cleanedTitle = title?.trim();
    const conversationId = await ctx.db.insert("conversations", {
      title: cleanedTitle || defaultConversationTitle(),
      titleMode: cleanedTitle ? "manual" : "default",
      status: "provisioning",
      agentToken: generateToken(),
      modelId: modelId?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    // Client immediately calls orchestrator.provisionConversation to kick off the VM.
    return { conversationId };
  },
});

/** Update the LLM model for a conversation. Takes effect on the next run. */
export const setModel = mutation({
  args: { conversationId: v.id("conversations"), modelId: v.string() },
  handler: async (ctx, { conversationId, modelId }) => {
    const row = await ctx.db.get(conversationId);
    if (!row || row.status === "deleted") throw new Error("Conversation not found");
    await ctx.db.patch(conversationId, { modelId: modelId.trim() || undefined, updatedAt: Date.now() });
  },
});

export const setThinkingLevel = mutation({
  args: { conversationId: v.id("conversations"), thinkingLevel: v.string() },
  handler: async (ctx, { conversationId, thinkingLevel }) => {
    const row = await ctx.db.get(conversationId);
    if (!row || row.status === "deleted") throw new Error("Conversation not found");
    await ctx.db.patch(conversationId, { thinkingLevel: thinkingLevel.trim() || undefined, updatedAt: Date.now() });
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
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
    sessionFileIds: v.optional(v.array(v.id("sessionFiles"))),
  },
  handler: async (
    ctx,
    { conversationId, content, sessionFileIds },
  ): Promise<{ runId: Id<"runs">; userMessageId: Id<"messages"> }> => {
    const trimmed = content.trim();
    if (!trimmed && (!sessionFileIds || sessionFileIds.length === 0)) {
      throw new Error("Message cannot be empty");
    }
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.status === "deleted") {
      throw new Error("Conversation not found");
    }

    const now = Date.now();
    const superseded = await supersedeInFlightRuns(ctx, conversationId, now);
    if (superseded) {
      await ctx.db.patch(conversationId, {
        status: "idle",
        lastError: undefined,
        updatedAt: now,
      });
    }

    const priorMessages = await ctx.db
      .query("messages")
      .withIndex("by_conversation_order", (q) => q.eq("conversationId", conversationId))
      .take(500);
    const nextOrder = priorMessages.length;

    const hasPriorUserMessage = priorMessages.some((message) => message.role === "user");

    const userMessageId = await ctx.db.insert("messages", {
      conversationId,
      role: "user",
      content: trimmed || "(file)",
      status: "completed",
      order: nextOrder,
      createdAt: now,
      sessionFileIds: sessionFileIds && sessionFileIds.length > 0 ? sessionFileIds : undefined,
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

    // Old conversations can have stale/missing daemons while still looking "idle" in the UI.
    // Trigger a lightweight revive check on every send so queued runs don't get stuck.
    await ctx.scheduler.runAfter(0, api.orchestrator.reviveDaemonIfDead, {
      conversationId,
    });

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
 * UI-triggered daemon revival. Forces re-launch regardless of heartbeat freshness.
 * Handles both stale heartbeat and explicit "error" status conversations.
 */
export const revive = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const row = await ctx.db.get(conversationId);
    if (!row || row.status === "deleted") return;
    // Allow reviving from any non-deleted state (error, idle with stale heartbeat, running stuck)
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

/** Internal query used by the sweeper to find the current in-flight run. */
export const activeRun = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<Doc<"runs"> | null> => {
    return ctx.db
      .query("runs")
      .withIndex("by_conv_status", (q) =>
        q.eq("conversationId", conversationId).eq("status", "running"),
      )
      .first();
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
      volumeName: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { conversationId, patch }) => {
    await ctx.db.patch(conversationId, { ...patch, updatedAt: Date.now() });
  },
});
