import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "../../lib/markdown";
import { formatChatTime, formatDuration } from "../../lib/formatters";
import type { MessageView, SessionFileView, ToolExecution } from "../../types";
import { InlineFileArtifact } from "./InlineFileArtifact";
import { InlineToolCall } from "./InlineToolCall";

interface MessageBubbleProps {
  message: MessageView;
  toolExecutions: ToolExecution[];
  fileArtifacts: SessionFileView[];
}

export function MessageBubble({ message, toolExecutions, fileArtifacts }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming" || message.status === "pending";
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showTime, setShowTime] = useState(false);

  return (
    <>
      <div
        className={clsx("group flex w-full gap-3", isUser ? "justify-end" : "justify-start")}
        onMouseEnter={() => setShowTime(true)}
        onMouseLeave={() => setShowTime(false)}
      >
        {!isUser ? <Avatar role={message.role} /> : null}

        <div className="flex min-w-0 flex-col gap-0.5">
          <div
            className={clsx(
              "flex max-w-[92%] sm:max-w-[88%] flex-col gap-1 rounded-2xl px-4 py-3",
              isUser
                ? "rounded-tr-sm bg-accent text-surface-0"
                : "rounded-tl-sm border border-border bg-surface-1 text-ink",
            )}
          >
            {isUser && message.sessionFiles.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.sessionFiles.map((sf) =>
                  sf.contentType?.startsWith("image/") && sf.downloadUrl ? (
                    <button
                      key={sf._id}
                      type="button"
                      onClick={() => setLightboxUrl(sf.downloadUrl!)}
                      className="overflow-hidden rounded-xl border border-white/20 transition-opacity hover:opacity-90"
                    >
                      <img
                        src={sf.downloadUrl}
                        alt={sf.displayName}
                        className="max-h-52 max-w-xs object-contain"
                      />
                    </button>
                  ) : (
                    <FileChip key={sf._id} file={sf} light />
                  ),
                )}
              </div>
            ) : null}

            {!isUser && message.thinkingContent ? <ThinkingBlock content={message.thinkingContent} /> : null}

            {message.content.length > 0 && message.content !== "(file)" ? (
              isUser ? (
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
              ) : (
                <Markdown>{message.content}</Markdown>
              )
            ) : !isUser ? (
              <p className="text-sm italic text-ink-soft">
                {message.status === "error" ? "(no response)" : "Thinking..."}
              </p>
            ) : null}

            {!isUser && isStreaming ? (
              <span aria-hidden className="inline-block h-3 w-[5px] animate-blink bg-accent" />
            ) : null}

            {!isUser && fileArtifacts.length > 0 ? (
              <div className="mt-2 space-y-1">
                {fileArtifacts.map((file) => (
                  <InlineFileArtifact key={file._id} file={file} />
                ))}
              </div>
            ) : null}

            {!isUser && toolExecutions.length > 0 ? (
              <ToolCallsGroup executions={toolExecutions} isRunning={isStreaming} />
            ) : null}
          </div>

          <span
            className={clsx(
              "px-1 text-[10px] text-ink-soft/60 transition-opacity duration-150",
              isUser ? "text-right" : "text-left",
              showTime ? "opacity-100" : "opacity-0",
            )}
          >
            {formatChatTime(message.createdAt)}
          </span>
        </div>

        {isUser ? <Avatar role={message.role} /> : null}
      </div>

      {lightboxUrl ? <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} /> : null}
    </>
  );
}

function ToolCallsGroup({
  executions,
  isRunning,
}: {
  executions: ToolExecution[];
  isRunning: boolean;
}) {
  const [open, setOpen] = useState(false);
  const totalMs = executions.reduce((s, e) => s + (e.durationMs ?? 0), 0);
  const uniqueNames = [...new Set(executions.map((e) => e.toolName))];
  const namesSummary = uniqueNames.slice(0, 3).join(", ") + (uniqueNames.length > 3 ? "..." : "");

  useEffect(() => {
    if (isRunning) setOpen(true);
  }, [isRunning]);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/60 bg-surface-0/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-ink-soft hover:bg-surface-2/50 transition-colors"
      >
        <span className={clsx("text-[11px]", isRunning && "animate-pulse text-warning")}>
          {isRunning ? "..." : open ? "v" : ">"}
        </span>
        <span className="font-medium text-ink">
          {executions.length} tool call{executions.length !== 1 ? "s" : ""}
        </span>
        {!isRunning ? (
          <>
            <span className="text-ink-soft/40">|</span>
            <span className="min-w-0 flex-1 truncate">{namesSummary}</span>
            <span className="shrink-0 font-mono text-[10px]">{formatDuration(totalMs)}</span>
          </>
        ) : (
          <span className="animate-pulse text-warning">Running...</span>
        )}
      </button>
      {open ? (
        <div className="border-t border-border/40 px-2 pb-2 pt-1">
          {executions.map((execution) => (
            <InlineToolCall key={execution._id} execution={execution} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const lines = content.trim().split("\n").length;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border/50 bg-surface-0/60 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink-soft hover:bg-surface-2/50 transition-colors"
      >
        <span className="text-[11px]">{open ? "v" : ">"}</span>
        <span className="italic">Thought for {lines} line{lines !== 1 ? "s" : ""}</span>
        <span className="ml-auto text-[10px] text-ink-soft/50">{open ? "Collapse" : "Expand"}</span>
      </button>
      {open ? (
        <div className="max-h-96 overflow-auto border-t border-border/40 px-3 py-2">
          <Markdown>{content.trim()}</Markdown>
        </div>
      ) : null}
    </div>
  );
}

function FileChip({ file, light }: { file: SessionFileView; light?: boolean }) {
  const handleDownload = async () => {
    if (!file.downloadUrl) return;
    const res = await fetch(file.downloadUrl);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.displayName ?? "download";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (file.downloadUrl) {
    return (
      <button
        type="button"
        onClick={() => void handleDownload()}
        className={clsx(
          "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition-colors",
          light
            ? "border-white/20 bg-white/10 text-surface-0 hover:bg-white/20"
            : "border-border bg-surface-0 text-ink hover:bg-surface-2",
        )}
      >
        <span>{fileIcon(file.contentType)}</span>
        <span className="max-w-[120px] truncate">{file.displayName}</span>
        <span className="text-[10px] opacity-60">↓</span>
      </button>
    );
  }
  return (
    <div
      className={clsx(
        "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px]",
        light ? "border-white/20 bg-white/10 text-surface-0" : "border-border bg-surface-0 text-ink",
      )}
    >
      <span>{fileIcon(file.contentType)}</span>
      <span className="max-w-[120px] truncate">{file.displayName}</span>
    </div>
  );
}

function fileIcon(contentType: string | undefined): string {
  if (!contentType) return "📎";
  if (contentType.startsWith("image/")) return "🖼";
  if (contentType.startsWith("video/")) return "🎬";
  if (contentType.startsWith("audio/")) return "🎵";
  if (contentType.includes("pdf")) return "📄";
  if (contentType.includes("zip") || contentType.includes("archive")) return "📦";
  if (contentType.startsWith("text/") || contentType.includes("json")) return "📝";
  return "📎";
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      className="fixed inset-0 m-auto max-h-[92vh] max-w-[92vw] rounded-2xl border border-border bg-surface-0 p-2 shadow-2xl backdrop:bg-black/70"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-surface-2 text-sm text-ink hover:bg-surface-3"
      >
        x
      </button>
      <img src={url} alt="attachment" className="max-h-[88vh] max-w-[88vw] rounded-xl object-contain" />
    </dialog>
  );
}

function Avatar({ role }: { role: MessageView["role"] }) {
  if (role === "user") return null;
  if (role === "assistant") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent/60 text-[11px] font-bold text-surface-0 shadow-sm">
        🤖
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning text-[10px] font-semibold text-surface-0">
      SYS
    </div>
  );
}
