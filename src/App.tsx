import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { StatusBar } from "./components/layout/StatusBar";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ConversationList } from "./components/conversation/ConversationList";
import { ObservabilityPanel } from "./components/observability/ObservabilityPanel";
import { useActiveRun } from "./hooks/useActiveRun";
import { useConversations } from "./hooks/useConversations";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { ConversationId, RunId } from "./types";

const THEME_STORAGE_KEY = "smart-pi-assistant:theme";

export default function App() {
  const [selectedId, setSelectedId] = useState<ConversationId | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<RunId | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" ? "light" : "dark";
  });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const previousLatestRunIdRef = useRef<RunId | null>(null);

  const conversations = useConversations();
  const active = useActiveRun(selectedId, selectedRunId);

  // Auto-select first conversation when list loads.
  useEffect(() => {
    if (!conversations) return;
    if (selectedId) {
      const stillExists = conversations.some((c) => c._id === selectedId);
      if (!stillExists) setSelectedId(conversations[0]?._id ?? null);
      return;
    }
    const firstConversation = conversations[0];
    if (firstConversation) setSelectedId(firstConversation._id);
  }, [conversations, selectedId]);

  // Clear selected timeline run when switching conversations.
  useEffect(() => {
    setSelectedRunId(null);
    previousLatestRunIdRef.current = null;
  }, [selectedId]);

  // If a new run arrives, jump observability back to the newest run immediately.
  useEffect(() => {
    const latestRunId = active.latestRun?._id ?? null;
    const previous = previousLatestRunIdRef.current;
    if (previous && latestRunId && previous !== latestRunId) {
      setSelectedRunId(null);
    }
    previousLatestRunIdRef.current = latestRunId;
  }, [active.latestRun?._id]);

  // Keep root class in sync for theme variants.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const handleNew = useCallback(() => {
    const btn = document.querySelector<HTMLButtonElement>("[data-test=new-conversation]");
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
      statusBar={<StatusBar conversation={active.conversation} />}
      sidebar={
        <ConversationList
          selectedId={selectedId}
          conversation={active.conversation}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          onSelect={setSelectedId}
          onDeleted={handleDeleted}
        />
      }
      chat={
        <ChatPanel
          ref={composerRef}
          conversationId={selectedId}
          active={active}
          selectedRunId={selectedRunId}
          onSelectRun={setSelectedRunId}
        />
      }
      observability={
        <ObservabilityPanel
          active={active}
          onResetRunSelection={() => setSelectedRunId(null)}
        />
      }
    />
  );
}
