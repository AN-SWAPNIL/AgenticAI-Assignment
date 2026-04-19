import clsx from "clsx";
import { useState } from "react";
import type { ActiveRunData } from "../../hooks/useActiveRun";
import { formatDuration, formatRelative } from "../../lib/formatters";
import { RawEventsDrawer } from "./RawEventsDrawer";
import { SessionFilesTable } from "./SessionFilesTable";
import { TimelineView } from "./TimelineView";
import { ToolHistoryTable } from "./ToolHistoryTable";
import { ToolStatsCards } from "./ToolStatsCards";

interface ObservabilityPanelProps {
  active: ActiveRunData;
}

type Tab = "timeline" | "tools" | "files" | "stats" | "raw";

const TABS: { id: Tab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "tools", label: "Tools" },
  { id: "files", label: "Files" },
  { id: "stats", label: "Stats" },
  { id: "raw", label: "Raw" },
];

export function ObservabilityPanel({ active }: ObservabilityPanelProps) {
  const [tab, setTab] = useState<Tab>("timeline");
  const latestRun = active.latestRun;
  const run = active.observabilityRun;
  const tools = active.toolExecutions ?? [];
  const events = active.timelineEvents ?? [];
  const files = active.sessionFiles ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Observability
        </h2>
        <RunSummary latestRun={latestRun} observabilityRun={run} />
      </header>

      <nav className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex-1 border-b-2 py-2 text-xs font-medium transition",
              tab === t.id
                ? "border-accent text-ink"
                : "border-transparent text-ink-soft hover:text-ink-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "timeline" && <TimelineView events={events} run={run} />}
        {tab === "tools" && <ToolHistoryTable executions={tools} />}
        {tab === "files" && <SessionFilesTable files={files} />}
        {tab === "stats" && <ToolStatsCards executions={tools} />}
        {tab === "raw" && <RawEventsDrawer events={events} />}
      </div>
    </div>
  );
}

function RunSummary({
  latestRun,
  observabilityRun,
}: {
  latestRun: ActiveRunData["latestRun"];
  observabilityRun: ActiveRunData["observabilityRun"];
}) {
  if (!latestRun) {
    return (
      <p className="mt-1 text-[12px] text-ink-soft">No runs in this conversation yet.</p>
    );
  }

  const duration =
    latestRun.startedAt && latestRun.completedAt
      ? formatDuration(latestRun.completedAt - latestRun.startedAt)
      : latestRun.startedAt
        ? "in progress"
        : "queued";

  return (
    <p className="mt-1 text-[12px] text-ink-soft">
      Latest run - <span className="text-ink-muted">{latestRun.status}</span> - {duration}
      {latestRun.startedAt ? ` - started ${formatRelative(latestRun.startedAt)}` : ""}
      {latestRun.error ? (
        <span className="block text-danger">{latestRun.error}</span>
      ) : null}
      {latestRun._id !== observabilityRun?._id ? (
        <span className="block">
          Showing telemetry for the previous active run until the queued run starts.
        </span>
      ) : null}
    </p>
  );
}
