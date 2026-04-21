import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../lib/markdown";
import { formatChatTime } from "../../lib/formatters";
import type { MessageView, SessionFileView, TimelineEvent, ToolExecution } from "../../types";
import { InlineFileArtifact } from "./InlineFileArtifact";
import { InlineToolCall } from "./InlineToolCall";

interface MessageBubbleProps {
  message: MessageView;
  timelineEvents: TimelineEvent[];
  toolExecutions: ToolExecution[];
  fileArtifacts: SessionFileView[];
}

export function MessageBubble({
  message,
  timelineEvents,
  toolExecutions,
  fileArtifacts,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isStreaming = message.status === "streaming" || message.status === "pending";
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showTime, setShowTime] = useState(false);
  const serialPhases = useMemo(
    () =>
      !isUser
        ? buildSerialPhases({
            events: timelineEvents,
            executions: toolExecutions,
            files: fileArtifacts,
            fallbackThinking: message.thinkingContent ?? "",
            fallbackOutput: message.content,
          })
        : [],
    [isUser, timelineEvents, toolExecutions, fileArtifacts, message.thinkingContent, message.content],
  );
  const hasAssistantPhases = serialPhases.length > 0;

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

            {!isUser
              ? serialPhases.map((phase) => {
                  if (phase.kind === "tools") {
                    return (
                      <div key={phase.key} className="space-y-1">
                        {phase.executions.map((execution) => (
                          <InlineToolCall key={execution._id} execution={execution} />
                        ))}
                      </div>
                    );
                  }
                  if (phase.kind === "thinking") {
                    return <ThinkingBlock key={phase.key} content={phase.content} isStreaming={isStreaming} />;
                  }
                  if (phase.kind === "files") {
                    return (
                      <div key={phase.key} className="mt-2 space-y-1">
                        {phase.files.map((file) => (
                          <InlineFileArtifact key={file._id} file={file} />
                        ))}
                      </div>
                    );
                  }
                  return (
                    <div key={phase.key} className="text-[15px] leading-relaxed">
                      <Markdown>{phase.content}</Markdown>
                    </div>
                  );
                })
              : null}

            {isUser ? (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
            ) : !hasAssistantPhases ? (
              <p className="text-sm italic text-ink-soft">
                {message.status === "error" ? "(no response)" : "Thinking..."}
              </p>
            ) : null}

            {!isUser && isStreaming ? (
              <span aria-hidden className="inline-block h-3 w-[5px] animate-blink bg-accent" />
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

type SerialPhase =
  | { kind: "thinking"; key: string; content: string }
  | { kind: "tools"; key: string; executions: ToolExecution[] }
  | { kind: "output"; key: string; content: string }
  | { kind: "files"; key: string; files: SessionFileView[] };

function buildSerialPhases(opts: {
  events: TimelineEvent[];
  executions: ToolExecution[];
  files: SessionFileView[];
  fallbackThinking: string;
  fallbackOutput: string;
}): SerialPhase[] {
  const phases: SerialPhase[] = [];
  const executionBySequence = new Map(opts.executions.map((execution) => [execution.sequence, execution]));
  const filesById = new Map(opts.files.map((file) => [String(file._id), file]));
  const usedExecutionIds = new Set<string>();
  const usedFileIds = new Set<string>();
  const sortedEvents = [...opts.events].sort((a, b) => a.sequence - b.sequence);

  let thinkingBuffer = "";
  let outputBuffer = "";
  let toolsBuffer: ToolExecution[] = [];
  let filesBuffer: SessionFileView[] = [];
  let lastThinkingSnapshot = "";
  let lastTextSnapshot = "";

  const flushThinking = () => {
    if (!thinkingBuffer.trim()) return;
    phases.push({
      kind: "thinking",
      key: `thinking-${phases.length + 1}`,
      content: thinkingBuffer,
    });
    thinkingBuffer = "";
  };

  const flushOutput = () => {
    if (!outputBuffer) return;
    phases.push({
      kind: "output",
      key: `output-${phases.length + 1}`,
      content: outputBuffer,
    });
    outputBuffer = "";
  };

  const flushTools = () => {
    if (toolsBuffer.length === 0) return;
    phases.push({
      kind: "tools",
      key: `tools-${phases.length + 1}`,
      executions: toolsBuffer,
    });
    toolsBuffer = [];
  };

  const flushFiles = () => {
    if (filesBuffer.length === 0) return;
    phases.push({
      kind: "files",
      key: `files-${phases.length + 1}`,
      files: filesBuffer,
    });
    filesBuffer = [];
  };

  let sawThinkingDelta = false;
  let sawTextDelta = false;

  for (const event of sortedEvents) {
    const assistantDeltas = extractAssistantDeltas(event);
    if (assistantDeltas.length > 0) {
      for (const assistantDelta of assistantDeltas) {
        const isSnapshot = assistantDelta.source === "snapshot";
        if (assistantDelta.kind === "thinking") {
          const normalizedDelta = isSnapshot
            ? suffixFromSnapshot(lastThinkingSnapshot, assistantDelta.delta)
            : assistantDelta.delta;
          if (isSnapshot) {
            lastThinkingSnapshot = assistantDelta.delta;
          }
          if (!normalizedDelta.trim()) continue;
          if (assistantDelta.source === "snapshot" && sawThinkingDelta) continue;
          if (assistantDelta.source === "delta") sawThinkingDelta = true;
          flushOutput();
          flushTools();
          flushFiles();
          thinkingBuffer += normalizedDelta;
          continue;
        }

        const normalizedDelta = isSnapshot
          ? suffixFromSnapshot(lastTextSnapshot, assistantDelta.delta)
          : assistantDelta.delta;
        if (isSnapshot) {
          lastTextSnapshot = assistantDelta.delta;
        }
        if (!normalizedDelta) continue;
        if (assistantDelta.source === "snapshot" && sawTextDelta) continue;
        if (assistantDelta.source === "delta") sawTextDelta = true;
        flushThinking();
        flushTools();
        flushFiles();
        outputBuffer += normalizedDelta;
      }
      continue;
    }

    if (event.type === "tool_execution_start") {
      flushThinking();
      flushOutput();
      flushFiles();
      const execution =
        executionBySequence.get(event.sequence) ??
        executionBySequence.get(event.sequence + 1) ??
        executionBySequence.get(event.sequence - 1) ??
        opts.executions.find((candidate) => !usedExecutionIds.has(candidate._id));
      if (execution && !usedExecutionIds.has(execution._id)) {
        toolsBuffer.push(execution);
        usedExecutionIds.add(execution._id);
      }
      continue;
    }

    const sharedFileId = extractSharedFileId(event);
    if (sharedFileId) {
      flushThinking();
      flushOutput();
      flushTools();
      const file = filesById.get(sharedFileId);
      if (file && !usedFileIds.has(String(file._id))) {
        filesBuffer.push(file);
        usedFileIds.add(String(file._id));
      }
      continue;
    }

    if (thinkingBuffer.length > 0 && event.type !== "message_update") {
      flushThinking();
    }

    if (outputBuffer.length > 0 && event.type !== "message_update") {
      flushOutput();
    }

    if (toolsBuffer.length > 0 && event.type !== "tool_execution_end") {
      flushTools();
    }

    if (filesBuffer.length > 0 && event.type !== "file_share_requested") {
      flushFiles();
    }
  }

  flushThinking();
  flushOutput();
  flushTools();
  flushFiles();

  const unmatchedExecutions = opts.executions.filter((execution) => !usedExecutionIds.has(execution._id));
  if (unmatchedExecutions.length > 0) {
    phases.push({
      kind: "tools",
      key: `tools-fallback-${phases.length + 1}`,
      executions: unmatchedExecutions,
    });
  }

  const unmatchedFiles = opts.files.filter((file) => !usedFileIds.has(String(file._id)));
  if (unmatchedFiles.length > 0) {
    phases.push({
      kind: "files",
      key: `files-fallback-${phases.length + 1}`,
      files: unmatchedFiles,
    });
  }

  if (
    !phases.some((phase) => phase.kind === "thinking") &&
    opts.fallbackThinking.trim().length > 0
  ) {
    phases.push({
      kind: "thinking",
      key: `thinking-fallback-${phases.length + 1}`,
      content: opts.fallbackThinking,
    });
  }

  const hasOutputPhase = phases.some((phase) => phase.kind === "output");
  if (!hasOutputPhase && opts.fallbackOutput.length > 0 && opts.fallbackOutput !== "(file)") {
    phases.push({
      kind: "output",
      key: `output-fallback-${phases.length + 1}`,
      content: opts.fallbackOutput,
    });
  }

  return phases;
}

type AssistantDelta =
  | { kind: "thinking"; delta: string; source: "delta" | "snapshot" }
  | { kind: "text"; delta: string; source: "delta" | "snapshot" };

function extractAssistantDeltas(event: TimelineEvent): AssistantDelta[] {
  let payload: Record<string, unknown> | null = null;
  try {
    payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
  } catch {
    return [];
  }

  const deltas: AssistantDelta[] = [];

  const messageUpdateEvent =
    asRecord(payload.assistantMessageEvent) ?? asRecord(payload.messageEvent);
  if (messageUpdateEvent) {
    const updateType = String(messageUpdateEvent.type ?? "");
    const delta = messageUpdateEvent.delta;
    if (typeof delta === "string" && isThinkingDeltaType(updateType)) {
      deltas.push({ kind: "thinking", delta, source: "delta" });
    }
    if (typeof delta === "string" && isTextDeltaType(updateType)) {
      deltas.push({ kind: "text", delta, source: "delta" });
    }
    if (deltas.length > 0) {
      return deltas;
    }
  }

  if (event.type !== "message_end" && event.type !== "turn_end") {
    return [];
  }

  const message = asRecord(payload.message);
  if (!message || String(message.role ?? "") !== "assistant") {
    return [];
  }

  const snapshotSegments = extractAssistantSegmentsFromMessage(message);
  return snapshotSegments.map((segment) => ({ ...segment, source: "snapshot" }));
}

function extractAssistantSegmentsFromMessage(message: Record<string, unknown>): Array<{
  kind: "thinking" | "text";
  delta: string;
}> {
  const out: Array<{ kind: "thinking" | "text"; delta: string }> = [];
  const content = Array.isArray(message.content) ? message.content : [];

  for (const part of content) {
    const record = asRecord(part);
    if (!record) continue;

    const partType = String(record.type ?? "").toLowerCase();
    const text = isThinkingPartType(partType)
      ? extractThinkingText(record)
      : firstString(record.text, record.delta, record.content, record.value);
    if (!text) continue;

    if (isThinkingPartType(partType)) {
      out.push({ kind: "thinking", delta: text });
    } else {
      out.push({ kind: "text", delta: text });
    }
  }

  if (out.length === 0) {
    const fallbackThinking = firstString(
      message.thinking,
      message.thinkingContent,
      message.reasoning,
      message.thought,
    );
    if (fallbackThinking) {
      out.push({ kind: "thinking", delta: fallbackThinking });
    }

    const fallbackText = firstString(message.text, message.output, message.response);
    if (fallbackText) {
      out.push({ kind: "text", delta: fallbackText });
    }
  }

  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function suffixFromSnapshot(previous: string, current: string): string {
  if (!current) return "";
  if (!previous) return current;
  if (current === previous) return "";
  if (current.startsWith(previous)) return current.slice(previous.length);
  if (previous.startsWith(current)) return "";
  return current;
}

function extractThinkingText(record: Record<string, unknown>): string {
  const primary = firstString(record.thinking, record.text, record.delta, record.content, record.value);
  if (primary) return primary;
  const summary = Array.isArray(record.summary) ? record.summary : [];
  const summaryText = summary
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => firstString(entry.text, entry.summary))
    .filter(Boolean)
    .join("\n\n");
  return summaryText;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return "";
}

function isThinkingDeltaType(type: string): boolean {
  const normalized = type.toLowerCase();
  return normalized.includes("thinking_delta") || normalized.includes("reasoning_delta");
}

function isTextDeltaType(type: string): boolean {
  const normalized = type.toLowerCase();
  return normalized.includes("text_delta");
}

function isThinkingPartType(type: string): boolean {
  const normalized = type.toLowerCase();
  return (
    normalized.includes("thinking") ||
    normalized.includes("reasoning") ||
    normalized.includes("thought")
  );
}

function extractSharedFileId(event: TimelineEvent): string | null {
  if (event.type !== "file_share_requested") return null;
  try {
    const payload = JSON.parse(event.payloadJson) as { sessionFileId?: unknown };
    return typeof payload.sessionFileId === "string" ? payload.sessionFileId : null;
  } catch {
    return null;
  }
}

function ThinkingBlock({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const [open, setOpen] = useState(isStreaming);
  const lines = content.trim().split("\n").length;

  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border/50 bg-surface-0/60 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-ink-soft hover:bg-surface-2/50 transition-colors"
      >
        <span className="text-[11px]">{open ? "v" : ">"}</span>
        <span className="italic">
          {isStreaming ? "Thinking live" : "Thought"} for {lines} line{lines !== 1 ? "s" : ""}
        </span>
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
