import { useMemo } from "react";
import { formatDuration } from "../../lib/formatters";
import type { ToolExecution } from "../../types";

interface ToolStatsCardsProps {
  executions: ToolExecution[];
}

interface ToolStat {
  name: string;
  count: number;
  totalMs: number;
  errors: number;
}

export function ToolStatsCards({ executions }: ToolStatsCardsProps) {
  const stats = useMemo<ToolStat[]>(() => {
    const map = new Map<string, ToolStat>();
    for (const tool of executions) {
      const existing = map.get(tool.toolName) ?? {
        name: tool.toolName,
        count: 0,
        totalMs: 0,
        errors: 0,
      };
      existing.count += 1;
      existing.totalMs += tool.durationMs ?? 0;
      if (tool.status === "error") existing.errors += 1;
      map.set(tool.toolName, existing);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [executions]);

  if (stats.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-ink-soft">
        Stats will populate once the agent calls a tool.
      </p>
    );
  }

  const totalCalls = stats.reduce((s, t) => s + t.count, 0);
  const totalMs = stats.reduce((s, t) => s + t.totalMs, 0);

  return (
    <div className="space-y-4 px-4 py-3">
      <div className="grid grid-cols-2 gap-2">
        <SummaryCard label="Total calls" value={String(totalCalls)} />
        <SummaryCard label="Total time" value={formatDuration(totalMs)} />
      </div>
      <ul className="space-y-2">
        {stats.map((stat) => {
          const avg = stat.count > 0 ? stat.totalMs / stat.count : 0;
          return (
            <li
              key={stat.name}
              className="flex items-center justify-between rounded-md border border-border bg-surface-0 px-3 py-2"
            >
              <div>
                <p className="font-mono text-[13px] font-semibold text-ink">{stat.name}</p>
                <p className="text-[11px] text-ink-soft">
                  {stat.count} call{stat.count === 1 ? "" : "s"} ·{" "}
                  {stat.errors} error{stat.errors === 1 ? "" : "s"}
                </p>
              </div>
              <div className="text-right text-[11px]">
                <p className="font-mono text-ink">avg {formatDuration(avg)}</p>
                <p className="font-mono text-ink-soft">total {formatDuration(stat.totalMs)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-0 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="font-mono text-[15px] text-ink">{value}</p>
    </div>
  );
}
