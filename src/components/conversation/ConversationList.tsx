import { useConversations } from "../../hooks/useConversations";
import type { ConversationId } from "../../types";
import { ConversationItem } from "./ConversationItem";
import { NewConversationButton } from "./NewConversationButton";

interface ConversationListProps {
  selectedId: ConversationId | null;
  onSelect: (id: ConversationId) => void;
  onDeleted: (id: ConversationId) => void;
}

export function ConversationList({
  selectedId,
  onSelect,
  onDeleted,
}: ConversationListProps) {
  const conversations = useConversations();

  return (
    <div className="flex h-full flex-col">
      <NewConversationButton onCreated={onSelect} />
      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
        {conversations === undefined ? (
          <p className="px-3 py-2 text-xs text-ink-soft">Loading…</p>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-soft">
            No conversations yet.
            <br />
            Create one to spin up a sandbox.
          </p>
        ) : (
          <ul className="flex flex-col gap-[2px]">
            {conversations.map((c) => (
              <li key={c._id}>
                <ConversationItem
                  conversation={c}
                  selected={c._id === selectedId}
                  onSelect={onSelect}
                  onDeleted={onDeleted}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="border-t border-border px-3 py-2 text-[10px] text-ink-soft">
        Each conversation owns one Daytona VM. Auto-stop after 30min idle.
      </footer>
    </div>
  );
}
