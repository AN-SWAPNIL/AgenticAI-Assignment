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
    <div
      className={clsx(
        "group flex w-full items-start gap-1 rounded-lg transition-colors",
        selected
          ? "bg-accent/10 ring-1 ring-accent/20"
          : "hover:bg-surface-2",
      )}
    >
      {/* Main select area — plain div when editing to avoid nesting input inside button */}
      {editing ? (
        <div className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5">
          <span
            className={clsx("mt-[5px] h-2 w-2 shrink-0 rounded-full", STATUS_DOT[conversation.status])}
            title={conversation.status}
          />
          <input
            value={draft}
            aria-label="Conversation title"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditing(false); setDraft(conversation.title); }
            }}
            autoFocus
            className="min-w-0 flex-1 rounded border border-border bg-surface-0 px-1 py-[2px] text-sm text-ink"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(conversation._id)}
          onDoubleClick={(e) => { e.preventDefault(); setEditing(true); }}
          className={clsx(
            "flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2.5 text-left",
            selected ? "text-ink" : "text-ink-muted hover:text-ink",
          )}
        >
          <span
            className={clsx("mt-[5px] h-2 w-2 shrink-0 rounded-full", STATUS_DOT[conversation.status])}
            title={conversation.status}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium leading-snug">
              {conversation.title}
            </span>
            <span className="text-[10px] text-ink-soft/70">
              {formatRelative(conversation.updatedAt)}
            </span>
          </span>
        </button>
      )}

      {/* Delete button — shown on hover */}
      <button
        type="button"
        onClick={handleDelete}
        className="mr-1 mt-2 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-ink-soft hover:bg-danger/20 hover:text-danger group-hover:flex"
        title="Delete conversation"
      >
        ×
      </button>
    </div>
  );
}
