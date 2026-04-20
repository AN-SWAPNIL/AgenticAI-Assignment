import clsx from "clsx";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatBytes } from "../../lib/formatters";
import type { SessionFileView } from "../../types";

interface InlineFileArtifactProps {
  file: SessionFileView;
}

const STATUS_TONE: Record<SessionFileView["status"], string> = {
  queued: "text-warning",
  processing: "text-warning",
  ready: "text-success",
  error: "text-danger",
};

export function InlineFileArtifact({ file }: InlineFileArtifactProps) {
  const markDownloaded = useMutation(api.files.markDownloaded);
  const canDownload = file.status === "ready" && Boolean(file.downloadUrl);

  const handleDownload = async () => {
    if (!file.downloadUrl) return;
    await markDownloaded({ sessionFileId: file._id });
    const res = await fetch(file.downloadUrl);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.displayName ?? "download";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="my-2 rounded-md border border-border bg-surface-1 px-3 py-2 text-[13px]">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-soft">file</span>
        <span className="truncate font-medium text-ink">{file.displayName}</span>
        <span className={clsx("ml-auto text-[11px] uppercase", STATUS_TONE[file.status])}>
          {file.status}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-ink-soft">
        <span>{file.direction}</span>
        <span>{formatBytes(file.sizeBytes)}</span>
        {file.sandboxPath ? <span className="truncate">{file.sandboxPath}</span> : null}
      </div>
      {file.error ? <p className="mt-1 text-[11px] text-danger">{file.error}</p> : null}
      {canDownload ? (
        <button
          type="button"
          onClick={() => void handleDownload()}
          className="mt-2 rounded border border-success/60 px-2 py-1 text-[11px] font-medium text-success hover:bg-success hover:text-surface-0"
        >
          Download
        </button>
      ) : file.status === "processing" || file.status === "queued" ? (
        <p className="mt-2 text-[11px] text-ink-soft">Preparing download...</p>
      ) : null}
    </div>
  );
}
