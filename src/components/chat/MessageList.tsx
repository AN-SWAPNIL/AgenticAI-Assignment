import { useEffect, useMemo, useRef } from "react";
import type { Message, ToolExecution } from "../../types";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  messages: Message[];
  toolExecutions: ToolExecution[];
}

export function MessageList({ messages, toolExecutions }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Group tool executions by their assistant message via runId. Convex provides the runId
  // on assistant messages already; we match by that.
  const toolsByMessage = useMemo(() => {
    const byRun = new Map<string, ToolExecution[]>();
    for (const tool of toolExecutions) {
      const list = byRun.get(tool.runId) ?? [];
      list.push(tool);
      byRun.set(tool.runId, list);
    }
    for (const list of byRun.values()) {
      list.sort((a, b) => a.sequence - b.sequence);
    }
    return byRun;
  }, [toolExecutions]);

  // Auto-scroll to bottom on new content. We track length AND last assistant content length
  // so streaming triggers re-scroll, not just new messages.
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => a.order - b.order),
    [messages],
  );
  const lastMessage = sortedMessages.at(-1);
  const lastSig = lastMessage ? `${sortedMessages.length}-${lastMessage.content.length}` : "0";
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastSig]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {sortedMessages.length === 0 ? (
          <EmptyState />
        ) : (
          sortedMessages.map((m) => (
            <MessageBubble
              key={m._id}
              message={m}
              toolExecutions={
                m.role === "assistant" && m.runId
                  ? toolsByMessage.get(m.runId) ?? []
                  : []
              }
            />
          ))
        )}
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
