import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { ConversationId, MessageView, SessionFileView, ToolExecution } from "../../types";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  conversationId: ConversationId | null;
  messages: MessageView[];
  toolExecutions: ToolExecution[];
  sessionFiles: SessionFileView[];
}

export function MessageList({ conversationId, messages, toolExecutions, sessionFiles }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Debounce search input to avoid firing on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchResults = useQuery(
    api.conversations.searchMessages,
    conversationId && debouncedQuery.trim()
      ? { conversationId, q: debouncedQuery.trim() }
      : "skip",
  );

  const searchResultIds = useMemo(
    () => new Set(searchResults?.map((m) => m._id) ?? []),
    [searchResults],
  );

  const toolsByMessage = useMemo(() => {
    const byRun = new Map<string, ToolExecution[]>();
    for (const tool of toolExecutions) {
      const list = byRun.get(tool.runId) ?? [];
      list.push(tool);
      byRun.set(tool.runId, list);
    }
    for (const list of byRun.values()) list.sort((a, b) => a.sequence - b.sequence);
    return byRun;
  }, [toolExecutions]);

  const filesByMessage = useMemo(() => {
    const byRun = new Map<string, SessionFileView[]>();
    for (const file of sessionFiles) {
      if (!file.runId || file.direction !== "download") continue;
      const list = byRun.get(file.runId) ?? [];
      list.push(file);
      byRun.set(file.runId, list);
    }
    for (const list of byRun.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    return byRun;
  }, [sessionFiles]);

  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.order - b.order),
    [messages],
  );

  const lastMessage = sortedMessages.at(-1);
  const lastSig = lastMessage ? `${sortedMessages.length}-${lastMessage.content.length}` : "0";
  useEffect(() => {
    if (debouncedQuery) return; // don't auto-scroll while searching
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastSig, debouncedQuery]);

  const displayedMessages = debouncedQuery.trim() && searchResults
    ? searchResults
    : sortedMessages;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Search bar */}
      <div className="border-b border-border bg-surface-1 px-6 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 text-ink-soft"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages…"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-soft/70"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(""); setDebouncedQuery(""); }}
              className="text-[11px] text-ink-soft hover:text-ink"
            >
              Clear
            </button>
          )}
          {debouncedQuery && searchResults && (
            <span className="text-[11px] text-ink-soft">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {debouncedQuery.trim() && searchResults?.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">No messages match "{debouncedQuery}"</p>
          ) : displayedMessages.length === 0 ? (
            <EmptyState />
          ) : (
            displayedMessages.map((m) => (
              <div
                key={m._id}
                className={
                  debouncedQuery && searchResultIds.has(m._id)
                    ? "rounded-xl ring-2 ring-accent/50"
                    : undefined
                }
              >
                <MessageBubble
                  message={m}
                  toolExecutions={
                    m.role === "assistant" && m.runId
                      ? toolsByMessage.get(m.runId) ?? []
                      : []
                  }
                  fileArtifacts={
                    m.role === "assistant" && m.runId
                      ? filesByMessage.get(m.runId) ?? []
                      : []
                  }
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  "List the workspace and write a short Python script that prints a Fibonacci sequence.",
  "Search the web for the latest Convex release and summarize the changes.",
  "Create a small Markdown report file describing what tools you have available.",
];

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-1 p-6">
      <h2 className="text-base font-semibold text-ink">Talk to the agent</h2>
      <p className="mt-1 text-sm text-ink-muted">
        This conversation has its own Daytona VM. Anything you ask runs there — try one of
        these to see the full loop:
      </p>
      <ul className="mt-3 space-y-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <li
            key={p}
            className="rounded-md border border-border bg-surface-0 px-3 py-2 text-sm text-ink-muted"
          >
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}
