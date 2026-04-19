import { forwardRef, useState, type KeyboardEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Conversation, ConversationId } from "../../types";

interface ComposerProps {
  conversationId: ConversationId;
  conversationStatus: Conversation["status"] | undefined;
}

const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer({ conversationId, conversationStatus }, ref) {
    const sendMessage = useMutation(api.conversations.sendMessage);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const disabled =
      busy ||
      conversationStatus === "provisioning" ||
      conversationStatus === "running" ||
      conversationStatus === "deleted";

    const placeholder =
      conversationStatus === "provisioning"
        ? "Sandbox is starting up… (≈30s)"
        : conversationStatus === "running"
          ? "Agent is working — this is single-turn, please wait."
          : conversationStatus === "error"
            ? "Daemon is in an error state — try Revive in the sidebar."
            : "Send a message (⌘↵)";

    const handleSend = async () => {
      const text = draft.trim();
      if (!text || disabled) return;
      setBusy(true);
      setError(null);
      try {
        await sendMessage({ conversationId, content: text });
        setDraft("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSend();
      }
    };

    return (
      <div className="border-t border-border bg-surface-1 px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-0 p-2 focus-within:border-accent">
            <textarea
              ref={ref}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder={placeholder}
              rows={2}
              disabled={disabled}
              className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-soft disabled:cursor-not-allowed"
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={disabled || draft.trim().length === 0}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
      </div>
    );
  },
);

export { Composer };
