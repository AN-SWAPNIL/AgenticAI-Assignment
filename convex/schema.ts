import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Schema for the isolated-agent chatbot.
 *
 * Plane separation (see README):
 *   - Control plane writes: conversations, messages(user), runs, user-triggered status transitions.
 *   - Execution plane (in-VM daemon) writes: messages(assistant), toolExecutions, timelineEvents,
 *     heartbeat updates on conversations. All VM writes authenticate with `agentToken` + `runToken`.
 */
export default defineSchema({
  /**
   * One row per conversation thread. Owns the mapping to a Daytona sandbox + session, plus
   * the agentToken shared secret used to authenticate VM → Convex mutations for this conversation.
   */
  conversations: defineTable({
    title: v.string(),
    // Optional for backward compatibility with pre-migration rows.
    titleMode: v.optional(
      v.union(v.literal("default"), v.literal("auto"), v.literal("manual")),
    ),
    status: v.union(
      v.literal("provisioning"),
      v.literal("idle"),
      v.literal("running"),
      v.literal("error"),
      v.literal("deleted"),
    ),
    sandboxId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    workspaceDir: v.optional(v.string()),
    runtimeDir: v.optional(v.string()),
    runtimeVersion: v.optional(v.string()),
    /** Shared secret passed to the daemon via env; required on every VM-originated mutation. */
    agentToken: v.string(),
    /** Unix ms of the last heartbeat from the daemon. Used by reviveDaemonIfDead and the orphan sweeper. */
    lastHeartbeatAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    /** Per-conversation LLM model override (e.g. "gemini-2.5-pro"). Falls back to env default. */
    modelId: v.optional(v.string()),
    /** Thinking/reasoning budget: "off" | "low" | "medium" | "high". Default "off". */
    thinkingLevel: v.optional(v.string()),
    /** Rolling summary of older conversation turns for long-context memory (RAG). */
    summaryContext: v.optional(v.string()),
    /** Daytona volume name for persistent workspace across sandbox restarts. */
    volumeName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_status_and_lastHeartbeatAt", ["status", "lastHeartbeatAt"])
    .index("by_updatedAt", ["updatedAt"]),

  /**
   * Ordered per-conversation transcript. Assistant messages stream in: status transitions
   * pending → streaming → completed as the daemon appends deltas and finalizes.
   * User messages may carry attachmentIds: storage references for images sent to the LLM.
   */
  messages: defineTable({
    conversationId: v.id("conversations"),
    runId: v.optional(v.id("runs")),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("streaming"),
      v.literal("completed"),
      v.literal("error"),
    ),
    order: v.number(),
    createdAt: v.number(),
    /** Session file IDs for files attached to user messages. Resolved to rich metadata + URLs on read. */
    sessionFileIds: v.optional(v.array(v.id("sessionFiles"))),
    /** Extended thinking / reasoning content produced by the model before the final response. */
    thinkingContent: v.optional(v.string()),
  })
    .index("by_conversation_order", ["conversationId", "order"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["conversationId"],
    }),

  /**
   * One row per user turn. The user inserts it via sendMessage (status: "queued"); the daemon
   * claims it atomically via ingest.claimRun, processes, and finalizes.
   */
  runs: defineTable({
    conversationId: v.id("conversations"),
    userMessageId: v.id("messages"),
    assistantMessageId: v.optional(v.id("messages")),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("error"),
    ),
    /** Per-run secret. Included with every VM mutation that mutates this run's data. */
    runToken: v.string(),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_conv_status", ["conversationId", "status"])
    .index("by_conv_createdAt", ["conversationId", "createdAt"]),

  /**
   * Per-tool-call audit trail. `inputJson` and `outputText` are strings (opaque to Convex
   * validators) to avoid schema churn as tools evolve.
   */
  toolExecutions: defineTable({
    conversationId: v.id("conversations"),
    runId: v.id("runs"),
    sequence: v.number(),
    toolName: v.string(),
    inputJson: v.string(),
    outputText: v.optional(v.string()),
    errorText: v.optional(v.string()),
    status: v.union(v.literal("running"), v.literal("success"), v.literal("error")),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  })
    .index("by_run_sequence", ["runId", "sequence"])
    .index("by_conversationId_and_startedAt", ["conversationId", "startedAt"]),

  /**
   * Agent lifecycle + streaming events. Fuels the observability timeline.
   * `payloadJson` is a raw string; frontend parses for display.
   */
  timelineEvents: defineTable({
    conversationId: v.id("conversations"),
    runId: v.id("runs"),
    sequence: v.number(),
    type: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  }).index("by_run_sequence", ["runId", "sequence"]),

  /**
   * Conversation-scoped file lifecycle across planes.
   * - upload: user -> Convex storage -> sandbox workspace
   * - download: sandbox workspace -> Convex storage -> signed URL
   */
  sessionFiles: defineTable({
    conversationId: v.id("conversations"),
    runId: v.optional(v.id("runs")),
    direction: v.union(v.literal("upload"), v.literal("download")),
    source: v.union(v.literal("user"), v.literal("agent")),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("ready"),
      v.literal("error"),
    ),
    displayName: v.string(),
    sandboxPath: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    contentType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    downloadedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversationId_and_createdAt", ["conversationId", "createdAt"])
    .index("by_conversationId_and_runId", ["conversationId", "runId"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"]),
});
