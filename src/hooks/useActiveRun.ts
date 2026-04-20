import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type {
  ConversationId,
  MessageView,
  Run,
  RunId,
  SessionFileView,
  TimelineEvent,
  ToolExecution,
} from "../types";

export interface ActiveRunData {
  conversation: ReturnType<typeof useQuery<typeof api.conversations.get>>;
  messages: MessageView[] | undefined;
  latestRun: Run | undefined | null;
  selectedRun: Run | undefined | null;
  observabilityRun: Run | undefined | null;
  isFocusedRun: boolean;
  toolExecutions: ToolExecution[] | undefined;
  conversationToolExecutions: ToolExecution[] | undefined;
  timelineEvents: TimelineEvent[] | undefined;
  sessionFiles: SessionFileView[] | undefined;
}

/**
 * Bundles all reactive chat + observability subscriptions for one conversation.
 * When selectedRunId is set (from clicking an assistant response), observability
 * follows that run; otherwise it follows the latest observable run.
 */
export function useActiveRun(
  conversationId: ConversationId | null,
  selectedRunId: RunId | null,
): ActiveRunData {
  const conversation = useQuery(
    api.conversations.get,
    conversationId ? { conversationId } : "skip",
  );
  const messages = useQuery(
    api.conversations.messages,
    conversationId ? { conversationId } : "skip",
  ) as MessageView[] | undefined;
  const latestRun = useQuery(
    api.conversations.latestRun,
    conversationId ? { conversationId } : "skip",
  );
  const latestObservableRun = useQuery(
    api.conversations.latestObservableRun,
    conversationId ? { conversationId } : "skip",
  );
  const selectedRun = useQuery(
    api.conversations.runById,
    selectedRunId ? { runId: selectedRunId } : "skip",
  );

  const focusedRun =
    selectedRun &&
    conversationId &&
    selectedRun.conversationId === conversationId
      ? selectedRun
      : null;

  const observabilityRun = focusedRun ?? latestObservableRun ?? null;
  const isFocusedRun = Boolean(focusedRun);

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
  const sessionFiles = useQuery(
    api.files.listForConversation,
    conversationId ? { conversationId } : "skip",
  );

  return {
    conversation,
    messages,
    latestRun,
    selectedRun: focusedRun,
    observabilityRun,
    isFocusedRun,
    toolExecutions,
    conversationToolExecutions,
    timelineEvents,
    sessionFiles,
  };
}
