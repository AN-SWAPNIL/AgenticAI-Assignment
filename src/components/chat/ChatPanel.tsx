import { forwardRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { ActiveRunData } from "../../hooks/useActiveRun";
import type { ConversationId, RunId } from "../../types";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";

interface ChatPanelProps {
  conversationId: ConversationId | null;
  active: ActiveRunData;
  selectedRunId: RunId | null;
  onSelectRun: (runId: RunId | null) => void;
}

export const ChatPanel = forwardRef<HTMLTextAreaElement, ChatPanelProps>(function ChatPanel(
  { conversationId, active, selectedRunId, onSelectRun },
  composerRef,
) {
  const revive = useMutation(api.conversations.revive);

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <h2 className="text-lg font-semibold text-ink">No conversation selected</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Create a conversation from the sidebar to launch an isolated workspace and start
            chatting.
          </p>
        </div>
      </div>
    );
  }

  const conversation = active.conversation;
  const messages = active.messages ?? [];
  const tools = active.conversationToolExecutions ?? [];
  const sessionFiles = active.sessionFiles ?? [];
  const status = conversation?.status;
  const canRevive = status === "error" || status === "provisioning";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {canRevive ? (
        <div className="flex items-center justify-between gap-3 border-b border-danger/30 bg-danger/8 px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-base">!</span>
            <div>
              <p className="text-[13px] font-medium text-danger">
                {status === "provisioning" ? "Workspace provisioning is stuck" : "Agent daemon stopped"}
              </p>
              {conversation?.lastError ? (
                <p className="text-[11px] text-danger/70">{conversation.lastError}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void revive({ conversationId })}
            className="shrink-0 rounded-lg border border-danger/50 bg-danger/10 px-3 py-1.5 text-[12px] font-medium text-danger hover:bg-danger hover:text-surface-0 transition-colors"
          >
            Revive
          </button>
        </div>
      ) : null}

      <MessageList
        conversationId={conversationId}
        messages={messages}
        toolExecutions={tools}
        sessionFiles={sessionFiles}
        selectedRunId={selectedRunId}
        onSelectRun={onSelectRun}
      />
      <Composer
        ref={composerRef}
        conversationId={conversationId}
        conversationStatus={conversation?.status}
        activeRun={active.latestRun}
      />
    </div>
  );
});
