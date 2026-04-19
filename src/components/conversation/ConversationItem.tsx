import clsx from "clsx";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { formatRelative } from "../../lib/formatters";
import type { Conversation, ConversationId } from "../../types";

interface ConversationItemProps {
  conversation: Conversation;
  selected: boolean;
  onSelect: (id: ConversationId) => void;
  onDeleted: (id: ConversationId) => void;
}

const STATUS_DOT: Record<Conversation["status"], string> = {
  provisioning: "bg-warning animate-pulse-dot",
  idle: "bg-success",
  running: "bg-accent animate-pulse-dot",
  error: "bg-danger",
  deleted: "bg-surface-3",
};

export function ConversationItem({
  conversation,
  selected,
  onSelect,
  onDeleted,
}: ConversationItemProps) {
  const remove = useMutation(api.conversations.remove);
  const rename = useMutation(api.conversations.rename);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  const handleDelete = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm("Delete this conversation and tear down its sandbox?")) return;
    onDeleted(conversation._id);
    await remove({ conversationId: conversation._id });
  };

  const commitRename = async () => {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== conversation.title) {
      await rename({ conversationId: conversation._id, title });
    } else {
      setDraft(conversation.title);
    }
  };

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation._id)}
      onDoubleClick={(e) => {
        e.preventDefault();
        setEditing(true);
      }}
      className={clsx(
        "group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
        selected
          ? "bg-surface-3 text-ink"
          : "text-ink-muted hover:bg-surface-2 hover:text-ink",
      )}
    >
      <span
        className={clsx("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[conversation.status])}
        title={conversation.status}
      />
      <span className="min-w-0 flex-1 truncate">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(conversation.title);
              }
            }}
            autoFocus
            className="w-full rounded border border-border bg-surface-0 px-1 py-[2px] text-sm text-ink"
          />
        ) : (
          conversation.title
        )}
      </span>
      <span className="shrink-0 text-[10px] text-ink-soft">
        {formatRelative(conversation.updatedAt)}
      </span>
      <span
        role="button"
        tabIndex={-1}
        onClick={handleDelete}
        className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-danger hover:text-surface-0 group-hover:flex"
        title="Delete"
      >
        ×
      </span>
    </button>
  );
}
