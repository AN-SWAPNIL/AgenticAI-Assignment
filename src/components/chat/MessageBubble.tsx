import clsx from "clsx";
import { Markdown } from "../../lib/markdown";
import type { Message, ToolExecution } from "../../types";
import { InlineToolCall } from "./InlineToolCall";

interface MessageBubbleProps {
  message: Message;
  toolExecutions: ToolExecution[];
}

/**
 * Renders a single chat bubble. For assistant messages we interleave any tool calls that
 * happened during this run *after* the text — the simplest faithful presentation given the
 * agent emits text deltas and tool calls without strong ordering hints.
 */
export function MessageBubble({ message, toolExecutions }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming" || message.status === "pending";

  return (
    <div className={clsx("flex w-full gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && <Avatar role={message.role} />}
      <div
        className={clsx(
          "flex max-w-[88%] flex-col gap-1 rounded-2xl px-4 py-3",
          isUser
            ? "bg-accent text-surface-0"
            : "border border-border bg-surface-1 text-ink",
        )}
      >
        {message.content.length > 0 ? (
          isUser ? (
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">
              {message.content}
            </p>
          ) : (
            <Markdown>{message.content}</Markdown>
          )
        ) : (
          !isUser && (
            <p className="text-sm italic text-ink-soft">
              {message.status === "error" ? "(no response)" : "Thinking…"}
            </p>
          )
        )}

        {!isUser && isStreaming && (
          <span
            aria-hidden
            className="inline-block h-3 w-[6px] animate-blink bg-accent"
          />
        )}

        {!isUser && toolExecutions.length > 0 && (
          <div className="mt-2">
            {toolExecutions.map((tool) => (
              <InlineToolCall key={tool._id} execution={tool} />
            ))}
          </div>
        )}
      </div>
      {isUser && <Avatar role={message.role} />}
    </div>
  );
}

function Avatar({ role }: { role: Message["role"] }) {
  const label = role === "user" ? "You" : role === "assistant" ? "Pi" : "Sys";
  return (
    <div
      className={clsx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        role === "user"
          ? "bg-accent-soft text-ink"
          : role === "assistant"
            ? "bg-surface-3 text-ink"
            : "bg-warning text-surface-0",
      )}
    >
      {label}
    </div>
  );
}
