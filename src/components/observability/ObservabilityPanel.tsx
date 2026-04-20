import clsx from "clsx";
import { useState } from "react";
import type { ActiveRunData } from "../../hooks/useActiveRun";
import { formatDuration, formatRelative } from "../../lib/formatters";
import { SessionFilesTable } from "./SessionFilesTable";
import { TimelineView } from "./TimelineView";

interface ObservabilityPanelProps {
  active: ActiveRunData;
  onResetRunSelection: () => void;
}

type Tab = "timeline" | "files";

const TABS: { id: Tab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "files", label: "Files" },
];

export function ObservabilityPanel({ active, onResetRunSelection }: ObservabilityPanelProps) {
  const [tab, setTab] = useState<Tab>("timeline");
  const latestRun = active.latestRun;
  const run = active.observabilityRun;
  const events = active.timelineEvents ?? [];
  const files = active.sessionFiles ?? [];
  const heartbeat = active.conversation?.lastHeartbeatAt;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border px-4 pb-2.5 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-soft/60">
            Observability
          </p>
          {active.isFocusedRun ? (
            <button
              type="button"
              onClick={onResetRunSelection}
              className="rounded border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-soft hover:bg-surface-2 hover:text-ink"
            >
              Latest
            </button>
          ) : null}
        </div>
        {heartbeat ? (
          <p className="mt-1 text-[10px] text-ink-soft">Daemon heartbeat: {formatRelative(heartbeat)}</p>
        ) : null}
        <RunSummary latestRun={latestRun} observabilityRun={run} isFocusedRun={active.isFocusedRun} />
      </header>

      <nav className="flex shrink-0 border-b border-border">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.id}
            type="button"
            onClick={() => setTab(tabDef.id)}
            className={clsx(
              "flex-1 border-b-2 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors",
              tab === tabDef.id
                ? "border-accent text-accent"
                : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {tabDef.label}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "timeline" ? <TimelineView events={events} run={run} /> : <SessionFilesTable files={files} />}
      </div>
    </div>
  );
}

const RUN_STATUS_BADGE: Record<string, string> = {
  queued: "bg-surface-3 text-ink-muted",
  claimed: "bg-warning/20 text-warning",
  running: "bg-accent/20 text-accent animate-pulse",
  completed: "bg-success/20 text-success",
  error: "bg-danger/20 text-danger",
};

function RunSummary({
  latestRun,
  observabilityRun,
  isFocusedRun,
}: {
  latestRun: ActiveRunData["latestRun"];
  observabilityRun: ActiveRunData["observabilityRun"];
  isFocusedRun: boolean;
}) {
  if (!latestRun) {
    return <p className="mt-1 text-[11px] text-ink-soft/50">No runs yet.</p>;
  }

  const duration =
    observabilityRun?.startedAt && observabilityRun.completedAt
      ? formatDuration(observabilityRun.completedAt - observabilityRun.startedAt)
      : observabilityRun?.startedAt
        ? "in progress"
        : "queued";

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
      <span
        className={clsx(
          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          RUN_STATUS_BADGE[observabilityRun?.status ?? latestRun.status] ?? "bg-surface-3 text-ink-muted",
        )}
      >
        {observabilityRun?.status ?? latestRun.status}
      </span>
      <span>{duration}</span>
      {observabilityRun?.startedAt ? <span>{formatRelative(observabilityRun.startedAt)}</span> : null}
      {observabilityRun?.error ? (
        <span className="w-full text-[11px] text-danger/80">{observabilityRun.error}</span>
      ) : null}
      {isFocusedRun ? (
        <span className="w-full text-[10px] text-warning/80">Showing selected response timeline.</span>
      ) : null}
    </div>
  );
}
