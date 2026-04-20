import { makeFunctionReference, type FunctionReference } from "convex/server";

/**
 * The bundled daemon can't import `convex/_generated/api` because it ships standalone into
 * a Daytona VM with no Convex codegen alongside it. Instead we hand-roll typed references
 * using `makeFunctionReference("module:export")` — Convex resolves these by name at the
 * server. The arg/return types here are intentionally loose; the strict shapes live on the
 * server side in convex/ingest.ts and we mirror them in `bridge.mutation<TArgs, TResult>()`.
 */

type Args = Record<string, unknown>;
type Q<TArgs extends Args, TResult> = FunctionReference<"query", "public", TArgs, TResult>;
type M<TArgs extends Args, TResult> = FunctionReference<"mutation", "public", TArgs, TResult>;

export const api = {
  ingest: {
    nextQueuedRun: makeFunctionReference<"query">("ingest:nextQueuedRun") as Q<
      { conversationId: string; agentToken: string },
      { _id: string; userMessageId: string; status: string } | null
    >,
    heartbeat: makeFunctionReference<"mutation">("ingest:heartbeat") as M<
      { conversationId: string; agentToken: string },
      null
    >,
    claimRun: makeFunctionReference<"mutation">("ingest:claimRun") as M<
      { conversationId: string; agentToken: string; runId: string },
      {
        runToken: string;
        modelId: string;
        userMessageContent: string;
        attachmentUrls: string[];
        attachedFiles: Array<{ name: string; contentType: string; sandboxPath: string | null; status: string }>;
        summaryContext: string | undefined;
      } | null
    >,
    ensureAssistantMessage: makeFunctionReference<"mutation">(
      "ingest:ensureAssistantMessage",
    ) as M<{ runId: string; runToken: string }, string>,
    appendAssistantDelta: makeFunctionReference<"mutation">(
      "ingest:appendAssistantDelta",
    ) as M<
      { runId: string; runToken: string; messageId: string; chunk: string },
      null
    >,
    syncAssistantMessageContent: makeFunctionReference<"mutation">(
      "ingest:syncAssistantMessageContent",
    ) as M<
      { runId: string; runToken: string; messageId: string; content: string },
      null
    >,
    syncThinkingContent: makeFunctionReference<"mutation">(
      "ingest:syncThinkingContent",
    ) as M<
      { runId: string; runToken: string; messageId: string; thinkingContent: string },
      null
    >,
    startToolExecution: makeFunctionReference<"mutation">(
      "ingest:startToolExecution",
    ) as M<
      {
        runId: string;
        runToken: string;
        sequence: number;
        toolName: string;
        inputJson: string;
      },
      string
    >,
    finishToolExecution: makeFunctionReference<"mutation">(
      "ingest:finishToolExecution",
    ) as M<
      {
        toolExecutionId: string;
        runToken: string;
        status: "success" | "error";
        outputText?: string;
        errorText?: string;
        durationMs: number;
      },
      null
    >,
    appendToolOutput: makeFunctionReference<"mutation">(
      "ingest:appendToolOutput",
    ) as M<
      { toolExecutionId: string; runToken: string; chunk: string },
      null
    >,
    appendTimelineEvent: makeFunctionReference<"mutation">(
      "ingest:appendTimelineEvent",
    ) as M<
      {
        runId: string;
        runToken: string;
        sequence: number;
        type: string;
        payloadJson: string;
      },
      null
    >,
    finalizeRun: makeFunctionReference<"mutation">("ingest:finalizeRun") as M<
      {
        runId: string;
        runToken: string;
        status: "completed" | "error";
        error?: string;
      },
      null
    >,
    requestFileExport: makeFunctionReference<"mutation">(
      "ingest:requestFileExport",
    ) as M<
      {
        runId: string;
        runToken: string;
        path: string;
        displayName?: string;
      },
      { sessionFileId: string }
    >,
    saveSummaryContext: makeFunctionReference<"mutation">(
      "ingest:saveSummaryContext",
    ) as M<
      { conversationId: string; agentToken: string; summary: string },
      null
    >,
  },
  conversations: {
    messages: makeFunctionReference<"query">("conversations:messages") as Q<
      { conversationId: string },
      Array<{
        _id: string;
        role: "user" | "assistant" | "system";
        content: string;
        order: number;
        attachmentUrls?: string[];
      }>
    >,
    get: makeFunctionReference<"query">("conversations:get") as Q<
      { conversationId: string },
      { summaryContext?: string; modelId?: string } | null
    >,
  },
};
