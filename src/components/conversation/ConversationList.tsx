import { useConversations } from "../../hooks/useConversations";
import type { Conversation, ConversationId } from "../../types";
import { ConversationItem } from "./ConversationItem";
import { NewConversationButton } from "./NewConversationButton";
import { SidebarSettings } from "./SidebarSettings";

interface ConversationListProps {
  selectedId: ConversationId | null;
  conversation: Conversation | null | undefined;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onSelect: (id: ConversationId) => void;
  onDeleted: (id: ConversationId) => void;
}

export function ConversationList({
  selectedId,
  conversation,
  theme,
  onToggleTheme,
  onSelect,
  onDeleted,
}: ConversationListProps) {
  const conversations = useConversations();

  return (
    <div className="flex h-full flex-col">
      <NewConversationButton onCreated={onSelect} />
      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
        {conversations === undefined ? (
          <p className="px-3 py-2 text-xs text-ink-soft">Loading...</p>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-ink-soft">
            No conversations yet.
            <br />
            Create one to launch your assistant workspace.
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
      <footer className="border-t border-border px-3 py-2">
        <SidebarSettings conversation={conversation} theme={theme} onToggleTheme={onToggleTheme} />
        <p className="mt-2 text-[10px] leading-relaxed text-ink-soft">
          <span className="hidden sm:inline">Each conversation runs in an isolated Daytona workspace.</span>
          <span className="sm:hidden">Isolated Daytona workspace per chat.</span>
        </p>
      </footer>
    </div>
  );
}
