import clsx from "clsx";
import { useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatBytes, formatRelative } from "../../lib/formatters";
import type { SessionFileView } from "../../types";

interface SessionFilesTableProps {
  files: SessionFileView[];
}

function fileIcon(contentType: string | undefined): string {
  if (!contentType) return "📎";
  if (contentType.startsWith("image/")) return "🖼";
  if (contentType.startsWith("video/")) return "🎬";
  if (contentType.startsWith("audio/")) return "🎵";
  if (contentType.includes("pdf")) return "📄";
  if (contentType.includes("zip") || contentType.includes("archive") || contentType.includes("tar")) return "📦";
  if (contentType.startsWith("text/") || contentType.includes("json") || contentType.includes("javascript") || contentType.includes("typescript")) return "📝";
  if (contentType.includes("spreadsheet") || contentType.includes("csv")) return "📊";
  return "📎";
}

const STATUS_DOT: Record<SessionFileView["status"], string> = {
  queued: "bg-warning animate-pulse",
  processing: "bg-warning animate-pulse",
  ready: "bg-success",
  error: "bg-danger",
};

export function SessionFilesTable({ files }: SessionFilesTableProps) {
  const markDownloaded = useMutation(api.files.markDownloaded);
  const sorted = useMemo(
    () => [...files].sort((a, b) => b.createdAt - a.createdAt),
    [files],
  );

  const handleDownload = async (file: SessionFileView) => {
    if (!file.downloadUrl) return;
    await markDownloaded({ sessionFileId: file._id });
    // Fetch and trigger a real download with the correct filename + extension
    const res = await fetch(file.downloadUrl);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.displayName ?? "download";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
        <span className="text-2xl opacity-30">📁</span>
        <p className="text-sm text-ink-soft">No file activity yet.</p>
        <p className="text-[11px] text-ink-soft/60">Files you upload or the agent exports appear here.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {sorted.map((file) => (
        <li key={file._id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40 transition-colors">
          {/* Icon */}
          <span className="shrink-0 text-lg leading-none" aria-hidden>
            {fileIcon(file.contentType)}
          </span>

          {/* Name + meta */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{file.displayName}</p>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-soft">
              <span className={clsx("inline-block h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[file.status])} />
              <span className="capitalize">{file.status}</span>
              <span>·</span>
              <span>{formatBytes(file.sizeBytes)}</span>
              <span>·</span>
              <span>{formatRelative(file.updatedAt)}</span>
              {file.error && <span className="text-danger">· {file.error}</span>}
            </div>
            {file.sandboxPath && (
              <p className="mt-0.5 truncate font-mono text-[10px] text-ink-soft/60">{file.sandboxPath}</p>
            )}
          </div>

          {/* Direction badge */}
          <span
            className={clsx(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              file.direction === "upload"
                ? "bg-accent/10 text-accent"
                : "bg-success/10 text-success",
            )}
          >
            {file.direction === "upload" ? "↑ Upload" : "↓ Export"}
          </span>

          {/* Download action */}
          {file.downloadUrl ? (
            <button
              type="button"
              onClick={() => void handleDownload(file)}
              className="shrink-0 rounded-md border border-success/50 px-2.5 py-1 text-[11px] font-medium text-success hover:bg-success hover:text-surface-0 transition-colors"
            >
              Download
            </button>
          ) : (
            <div className="w-[72px] shrink-0" />
          )}
        </li>
      ))}
    </ul>
  );
}
