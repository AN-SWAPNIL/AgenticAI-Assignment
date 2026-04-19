import clsx from "clsx";
import { useMemo } from "react";
import { compactJson, formatDuration } from "../../lib/formatters";
import type { ToolExecution } from "../../types";

interface ToolHistoryTableProps {
  executions: ToolExecution[];
}

export function ToolHistoryTable({ executions }: ToolHistoryTableProps) {
  const sorted = useMemo(
    () => [...executions].sort((a, b) => a.sequence - b.sequence),
    [executions],
  );

  if (sorted.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-ink-soft">
        No tool executions yet for this run.
      </p>
    );
  }

  return (
    <table className="w-full table-fixed text-[12px]">
      <thead className="sticky top-0 bg-surface-1 text-left text-[10px] uppercase tracking-wide text-ink-soft">
        <tr>
          <th className="w-10 px-3 py-2">#</th>
          <th className="w-24 px-3 py-2">Tool</th>
          <th className="px-3 py-2">Input</th>
          <th className="w-16 px-3 py-2 text-right">Time</th>
          <th className="w-14 px-3 py-2 text-right">Status</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((tool) => (
          <tr key={tool._id} className="border-t border-border align-top">
            <td className="px-3 py-2 font-mono text-ink-soft">{tool.sequence}</td>
            <td className="px-3 py-2 font-mono text-ink">{tool.toolName}</td>
            <td className="px-3 py-2 font-mono text-ink-muted">
              <span className="block truncate" title={compactJson(tool.inputJson, 1000)}>
                {compactJson(tool.inputJson, 60)}
              </span>
            </td>
            <td className="px-3 py-2 text-right font-mono text-ink-muted">
              {formatDuration(tool.durationMs)}
            </td>
            <td
              className={clsx(
                "px-3 py-2 text-right font-mono uppercase",
                tool.status === "success" && "text-success",
                tool.status === "error" && "text-danger",
                tool.status === "running" && "text-warning",
              )}
            >
              {tool.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
