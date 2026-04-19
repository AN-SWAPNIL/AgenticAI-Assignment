import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { StatusBar } from "./components/layout/StatusBar";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ConversationList } from "./components/conversation/ConversationList";
import { ObservabilityPanel } from "./components/observability/ObservabilityPanel";
import { useActiveRun } from "./hooks/useActiveRun";
import { useConversations } from "./hooks/useConversations";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { ConversationId } from "./types";

const THEME_STORAGE_KEY = "pi-agent-theme";

export default function App() {
  const [selectedId, setSelectedId] = useState<ConversationId | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  });
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const conversations = useConversations();
  const active = useActiveRun(selectedId);

  // Auto-select the first conversation if none is selected and the list arrives.
  useEffect(() => {
    const firstConversation = conversations?.[0];
    if (selectedId || !firstConversation) return;
    setSelectedId(firstConversation._id);
  }, [conversations, selectedId]);

  // Keep the html element's class in sync for tailwind's dark/light variants.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const handleNew = useCallback(() => {
    // Surface the New button programmatically by clicking; the button itself owns the
    // mutation+action sequence so we don't duplicate that here.
    const btn = document.querySelector<HTMLButtonElement>(
      "[data-test=new-conversation], button:has(kbd)",
    );
    btn?.click();
  }, []);

  const handleFocusComposer = useCallback(() => {
    composerRef.current?.focus();
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  useKeyboardShortcuts({
    onNewConversation: handleNew,
    onFocusComposer: handleFocusComposer,
    onToggleTheme: handleToggleTheme,
  });

  const handleDeleted = useCallback(
    (id: ConversationId) => {
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId],
  );

  return (
    <AppShell
      statusBar={
        <StatusBar
          conversation={active.conversation}
          theme={theme}
          onToggleTheme={handleToggleTheme}
        />
      }
      sidebar={
        <ConversationList
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDeleted={handleDeleted}
        />
      }
      chat={
        <ChatPanel
          ref={composerRef}
          conversationId={selectedId}
          active={active}
        />
      }
      observability={<ObservabilityPanel active={active} />}
    />
  );
}
