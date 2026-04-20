import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { ConversationId } from "../../types";

interface NewConversationButtonProps {
  onCreated: (id: ConversationId) => void;
}

export function NewConversationButton({ onCreated }: NewConversationButtonProps) {
  const create = useMutation(api.conversations.create);
  const provision = useAction(api.orchestrator.provisionConversation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { conversationId } = await create({});
      onCreated(conversationId);
      provision({ conversationId }).catch((err) => {
        console.error("[ui] provision failed:", err);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 px-3 pt-3">
      <button
        data-test="new-conversation"
        type="button"
        onClick={handle}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Creating..." : "New conversation"}
        <kbd className="rounded bg-surface-0/30 px-1 py-[1px] text-[10px] font-mono">Ctrl/Cmd+K</kbd>
      </button>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
