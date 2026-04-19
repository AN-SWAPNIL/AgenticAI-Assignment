import clsx from "clsx";
import { useMemo } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatBytes, formatRelative } from "../../lib/formatters";
import type { SessionFileView } from "../../types";

interface SessionFilesTableProps {
  files: SessionFileView[];
}

export function SessionFilesTable({ files }: SessionFilesTableProps) {
  const markDownloaded = useMutation(api.files.markDownloaded);
  const sorted = useMemo(
    () => [...files].sort((a, b) => b.createdAt - a.createdAt),
    [files],
  );

  const handleDownload = async (file: SessionFileView) => {
    if (!file.downloadUrl) return;
    await markDownloaded({ sessionFileId: file._id });
    window.open(file.downloadUrl, "_blank", "noopener,noreferrer");
  };

  if (sorted.length === 0) {
    return <p className="px-4 py-6 text-sm text-ink-soft">No file activity yet.</p>;
  }

  return (
    <table className="w-full table-fixed text-[12px]">
      <thead className="sticky top-0 bg-surface-1 text-left text-[10px] uppercase tracking-wide text-ink-soft">
        <tr>
          <th className="w-20 px-3 py-2">Flow</th>
          <th className="px-3 py-2">File</th>
          <th className="w-20 px-3 py-2 text-right">Size</th>
          <th className="w-20 px-3 py-2 text-right">Status</th>
          <th className="w-28 px-3 py-2 text-right">When</th>
          <th className="w-24 px-3 py-2 text-right">Action</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((file) => (
          <tr key={file._id} className="border-t border-border align-top">
            <td className="px-3 py-2 font-mono text-ink-muted">
              {file.source}/{file.direction}
            </td>
            <td className="px-3 py-2">
              <p className="truncate font-medium text-ink">{file.displayName}</p>
              {file.sandboxPath ? (
                <p className="truncate font-mono text-[10px] text-ink-soft">{file.sandboxPath}</p>
              ) : null}
              {file.error ? <p className="text-[10px] text-danger">{file.error}</p> : null}
            </td>
            <td className="px-3 py-2 text-right font-mono text-ink-muted">
              {formatBytes(file.sizeBytes)}
            </td>
            <td
              className={clsx(
                "px-3 py-2 text-right font-mono uppercase",
                file.status === "ready" && "text-success",
                file.status === "error" && "text-danger",
                (file.status === "queued" || file.status === "processing") && "text-warning",
              )}
            >
              {file.status}
            </td>
            <td className="px-3 py-2 text-right text-ink-soft">
              {formatRelative(file.updatedAt)}
            </td>
            <td className="px-3 py-2 text-right">
              {file.status === "ready" && file.downloadUrl ? (
                <button
                  type="button"
                  onClick={() => void handleDownload(file)}
                  className="rounded border border-success/60 px-2 py-1 text-[10px] font-medium text-success hover:bg-success hover:text-surface-0"
                >
                  Download
                </button>
              ) : (
                <span className="text-[10px] text-ink-soft">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
