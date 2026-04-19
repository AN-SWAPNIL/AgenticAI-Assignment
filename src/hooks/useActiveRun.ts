import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  ConversationId,
  Message,
  Run,
  TimelineEvent,
  ToolExecution,
} from "../types";

export interface ActiveRunData {
  conversation: ReturnType<typeof useQuery<typeof api.conversations.get>>;
  messages: Message[] | undefined;
  latestRun: Run | undefined | null;
  observabilityRun: Run | undefined | null;
  toolExecutions: ToolExecution[] | undefined;
  conversationToolExecutions: ToolExecution[] | undefined;
  timelineEvents: TimelineEvent[] | undefined;
}

/**
 * Bundles every reactive query the chat + observability views need for a single conversation.
 * Convex deduplicates these subscriptions across hook calls, so spreading them out is fine.
 */
export function useActiveRun(conversationId: ConversationId | null): ActiveRunData {
  const conversation = useQuery(
    api.conversations.get,
    conversationId ? { conversationId } : "skip",
  );
  const messages = useQuery(
    api.conversations.messages,
    conversationId ? { conversationId } : "skip",
  );
  const latestRun = useQuery(
    api.conversations.latestRun,
    conversationId ? { conversationId } : "skip",
  );
  const observabilityRun = useQuery(
    api.conversations.latestObservableRun,
    conversationId ? { conversationId } : "skip",
  );
  const toolExecutions = useQuery(
    api.conversations.toolExecutions,
    observabilityRun ? { runId: observabilityRun._id } : "skip",
  );
  const conversationToolExecutions = useQuery(
    api.conversations.toolExecutionsForConversation,
    conversationId ? { conversationId, limit: 600 } : "skip",
  );
  const timelineEvents = useQuery(
    api.conversations.timelineEvents,
    observabilityRun ? { runId: observabilityRun._id } : "skip",
  );

  return {
    conversation,
    messages,
    latestRun,
    observabilityRun,
    toolExecutions,
    conversationToolExecutions,
    timelineEvents,
  };
}
