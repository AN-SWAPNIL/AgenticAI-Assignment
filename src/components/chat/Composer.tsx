import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Conversation, ConversationId, Run } from "../../types";

interface PendingFile {
  sessionFileId: Id<"sessionFiles">;
  previewUrl: string | null; // object URL for images (revoke on send), null for others
  name: string;
  contentType: string;
  sizeBytes: number;
}

interface ComposerProps {
  conversationId: ConversationId;
  conversationStatus: Conversation["status"] | undefined;
  activeRun?: Run | null;
}

const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer({ conversationId, conversationStatus, activeRun }, ref) {
    const sendMessage = useMutation(api.conversations.sendMessage);
    const cancelRun = useMutation(api.ingest.cancelRun);
    const generateUploadUrl = useMutation(api.files.generateUploadUrl);
    const registerUpload = useMutation(api.files.registerUpload);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [attachingCount, setAttachingCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [attachError, setAttachError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);

    const isBusy =
      busy ||
      conversationStatus === "provisioning" ||
      conversationStatus === "running" ||
      conversationStatus === "deleted";

    const canSend = !isBusy && (draft.trim().length > 0 || pendingFiles.length > 0);

    const placeholder =
      conversationStatus === "provisioning"
        ? "Sandbox is starting up… (~30s)"
        : conversationStatus === "running"
          ? "Agent is working — wait for this turn to finish."
          : conversationStatus === "error"
            ? "Daemon is in error state. You can still attach files or revive."
            : "Message the agent… (Ctrl/Cmd + Enter to send)";

    const uploadAndRegister = async (file: File): Promise<PendingFile> => {
      const uploadUrl = await generateUploadUrl({ conversationId });
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: file.type ? { "Content-Type": file.type } : undefined,
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed for "${file.name}" (${res.status})`);
      const { storageId } = (await res.json()) as { storageId?: string };
      if (!storageId) throw new Error(`No storageId returned for "${file.name}"`);

      const { sessionFileId } = await registerUpload({
        conversationId,
        storageId: storageId as Id<"_storage">,
        displayName: file.name,
        contentType: file.type || undefined,
        sizeBytes: file.size,
      });

      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : null;

      return {
        sessionFileId: sessionFileId as Id<"sessionFiles">,
        previewUrl,
        name: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      };
    };

    const attachFiles = async (files: File[]) => {
      if (files.length === 0 || isBusy) return;
      setAttachError(null);
      setAttachingCount((n) => n + files.length);
      try {
        const results = await Promise.all(files.map(uploadAndRegister));
        setPendingFiles((prev) => [...prev, ...results]);
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : String(err));
      } finally {
        setAttachingCount((n) => n - files.length);
      }
    };

    const removePending = (id: Id<"sessionFiles">) => {
      setPendingFiles((prev) => {
        const removed = prev.find((f) => f.sessionFileId === id);
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        return prev.filter((f) => f.sessionFileId !== id);
      });
    };

    const handleSend = async () => {
      if (!canSend) return;
      setBusy(true);
      setError(null);
      const sessionFileIds = pendingFiles.map((f) => f.sessionFileId);
      const content = draft.trim() || "(file)";
      try {
        await sendMessage({
          conversationId,
          content,
          sessionFileIds: sessionFileIds.length > 0 ? sessionFileIds : undefined,
        });
        setDraft("");
        pendingFiles.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
        setPendingFiles([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void handleSend();
      }
    };

    const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      await attachFiles(files);
    };

    const handlePaste = useCallback(
      async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = Array.from(e.clipboardData?.items ?? []);
        const imageItem = items.find((i) => i.type.startsWith("image/"));
        if (!imageItem) return;
        e.preventDefault();
        const file = imageItem.getAsFile();
        if (file) await attachFiles([file]);
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [conversationId, isBusy],
    );

    const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) await attachFiles(files);
    };

    return (
      <div
        className="border-t border-border bg-surface-1 px-4 py-3"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { void handleDrop(e); }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {/* Pending file pills */}
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingFiles.map((f) => (
                <div
                  key={f.sessionFileId}
                  className="group flex items-center gap-1.5 rounded-full border border-border bg-surface-0 pl-1.5 pr-2 py-1"
                >
                  {f.previewUrl ? (
                    <img src={f.previewUrl} alt={f.name} className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-3 text-[10px]">
                      {fileIcon(f.contentType)}
                    </span>
                  )}
                  <span className="max-w-[100px] truncate text-[11px] text-ink">{f.name}</span>
                  <button
                    type="button"
                    onClick={() => removePending(f.sessionFileId)}
                    className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-ink-soft hover:bg-danger/20 hover:text-danger"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div
            className={`flex items-end gap-2 rounded-2xl border bg-surface-0 px-3 py-2 transition-colors focus-within:border-accent ${
              dragOver ? "border-accent bg-accent/5 border-dashed" : "border-border"
            }`}
          >
            <textarea
              ref={ref}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              onPaste={(e) => { void handlePaste(e); }}
              placeholder={dragOver ? "Drop files to attach…" : placeholder}
              rows={2}
              disabled={isBusy}
              className="min-h-[40px] flex-1 resize-none bg-transparent py-1 text-sm text-ink outline-none placeholder:text-ink-soft/60 disabled:cursor-not-allowed"
            />

            <input
              ref={fileInputRef}
              type="file"
              multiple
              aria-label="Attach files"
              className="hidden"
              onChange={(e) => { void handleFileInput(e); }}
            />

            {/* Attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy || attachingCount > 0}
              title="Attach files (images shown to LLM + copied to sandbox; other files copied to sandbox)"
              className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              {attachingCount > 0 ? (
                <span className="text-[14px] animate-spin">⋯</span>
              ) : (
                <PaperclipIcon />
              )}
            </button>

            {/* Stop button (while agent is running) */}
            {conversationStatus === "running" && activeRun ? (
              <button
                type="button"
                onClick={() => void cancelRun({ runId: activeRun._id })}
                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-danger text-surface-0 hover:bg-danger/80 transition-colors"
                title="Stop agent"
              >
                <StopIcon />
              </button>
            ) : (
              /* Send button */
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-accent text-surface-0 hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                title="Send (Ctrl/Cmd + Enter)"
              >
                <SendIcon />
              </button>
            )}
          </div>

          {/* Status messages */}
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {attachError && <p className="text-[12px] text-danger">{attachError}</p>}
          {attachingCount > 0 && !attachError && (
            <p className="text-[11px] text-ink-soft">Uploading {attachingCount} file{attachingCount > 1 ? "s" : ""}…</p>
          )}
        </div>
      </div>
    );
  },
);

function fileIcon(contentType: string): string {
  if (contentType.startsWith("image/")) return "🖼";
  if (contentType.startsWith("video/")) return "🎬";
  if (contentType.startsWith("audio/")) return "🎵";
  if (contentType.includes("pdf")) return "📄";
  if (contentType.includes("zip") || contentType.includes("archive")) return "📦";
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("javascript")) return "📝";
  return "📎";
}

function PaperclipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </svg>
  );
}

export { Composer };
