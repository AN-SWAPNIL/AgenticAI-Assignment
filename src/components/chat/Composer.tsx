import {
  forwardRef,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Conversation, ConversationId } from "../../types";

interface ComposerProps {
  conversationId: ConversationId;
  conversationStatus: Conversation["status"] | undefined;
}

const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  function Composer({ conversationId, conversationStatus }, ref) {
    const sendMessage = useMutation(api.conversations.sendMessage);
    const generateUploadUrl = useMutation(api.files.generateUploadUrl);
    const registerUpload = useMutation(api.files.registerUpload);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState("");
    const [busy, setBusy] = useState(false);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [uploadError, setUploadError] = useState<string | null>(null);

    const disabledSend =
      busy ||
      conversationStatus === "provisioning" ||
      conversationStatus === "running" ||
      conversationStatus === "deleted";

    const disabledUpload =
      uploadingCount > 0 ||
      conversationStatus === "provisioning" ||
      conversationStatus === "deleted";

    const placeholder =
      conversationStatus === "provisioning"
        ? "Sandbox is starting up... (~30s)"
        : conversationStatus === "running"
          ? "Agent is working; wait for this turn to finish."
          : conversationStatus === "error"
            ? "Daemon is in an error state. You can still upload files or revive."
            : "Send a message (Ctrl/Cmd + Enter)";

    const handleSend = async () => {
      const text = draft.trim();
      if (!text || disabledSend) return;
      setBusy(true);
      setError(null);
      try {
        await sendMessage({ conversationId, content: text });
        setDraft("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };

    const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void handleSend();
      }
    };

    const uploadOne = async (file: File) => {
      const uploadUrl = await generateUploadUrl({ conversationId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: file.type ? { "Content-Type": file.type } : undefined,
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed for ${file.name} (status ${response.status})`);
      }
      const json = (await response.json()) as { storageId?: string };
      if (!json.storageId) {
        throw new Error(`Upload response missing storageId for ${file.name}`);
      }

      await registerUpload({
        conversationId,
        storageId: json.storageId as Id<"_storage">,
        displayName: file.name,
        contentType: file.type || undefined,
        sizeBytes: file.size,
      });
    };

    const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";
      if (files.length === 0 || disabledUpload) return;

      setUploadError(null);
      setUploadingCount(files.length);
      try {
        for (const file of files) {
          await uploadOne(file);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploadingCount(0);
      }
    };

    return (
      <div className="border-t border-border bg-surface-1 px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-surface-0 p-2 focus-within:border-accent">
            <textarea
              ref={ref}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder={placeholder}
              rows={2}
              disabled={disabledSend}
              className="min-h-[44px] flex-1 resize-none bg-transparent px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-soft disabled:cursor-not-allowed"
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleFileSelection(e);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabledUpload}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Upload
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={disabledSend || draft.trim().length === 0}
              className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
          {uploadingCount > 0 ? (
            <p className="text-[12px] text-ink-soft">Uploading {uploadingCount} file(s)...</p>
          ) : null}
          {error ? <p className="text-[12px] text-danger">{error}</p> : null}
          {uploadError ? <p className="text-[12px] text-danger">{uploadError}</p> : null}
        </div>
      </div>
    );
  },
);

export { Composer };
