import { forwardRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { ActiveRunData } from "../../hooks/useActiveRun";
import type { ConversationId } from "../../types";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatPanelProps {
  conversationId: ConversationId | null;
  active: ActiveRunData;
}

export const ChatPanel = forwardRef<HTMLTextAreaElement, ChatPanelProps>(
  function ChatPanel({ conversationId, active }, composerRef) {
    const revive = useMutation(api.conversations.revive);

    if (!conversationId) {
      return (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <div className="max-w-md">
            <h2 className="text-lg font-semibold text-ink">No conversation selected</h2>
            <p className="mt-2 text-sm text-ink-muted">
              Create a new conversation from the sidebar to provision an isolated Daytona
              sandbox and start chatting with the agent.
            </p>
          </div>
        </div>
      );
    }

    const conversation = active.conversation;
    const messages = active.messages ?? [];
    const tools = active.conversationToolExecutions ?? [];
    const errorActive = conversation?.status === "error";

    return (
      <div className="flex h-full min-h-0 flex-col">
        {errorActive && (
          <div className="flex items-center justify-between gap-3 border-b border-danger/40 bg-danger/10 px-6 py-2 text-sm text-danger">
            <span>
              Daemon reported an error
              {conversation?.lastError ? `: ${conversation.lastError}` : ""}.
            </span>
            <button
              type="button"
              onClick={() => revive({ conversationId })}
              className="rounded-md border border-danger/60 px-3 py-1 text-xs font-medium hover:bg-danger hover:text-surface-0"
            >
              Revive daemon
            </button>
          </div>
        )}

        <MessageList messages={messages} toolExecutions={tools} />
        <Composer
          ref={composerRef}
          conversationId={conversationId}
          conversationStatus={conversation?.status}
        />
      </div>
    );
  },
);
