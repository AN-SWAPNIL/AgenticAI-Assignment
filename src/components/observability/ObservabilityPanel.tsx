import clsx from "clsx";
import { useState } from "react";
import type { ActiveRunData } from "../../hooks/useActiveRun";
import { formatDuration, formatRelative } from "../../lib/formatters";
import { SessionFilesTable } from "./SessionFilesTable";
import { TimelineView } from "./TimelineView";

interface ObservabilityPanelProps {
  active: ActiveRunData;
}

type Tab = "timeline" | "files";

const TABS: { id: Tab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "files",    label: "Files"    },
];

export function ObservabilityPanel({ active }: ObservabilityPanelProps) {
  const [tab, setTab] = useState<Tab>("timeline");
  const latestRun = active.latestRun;
  const run = active.observabilityRun;
  const events = active.timelineEvents ?? [];
  const files = active.sessionFiles ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 pb-2.5 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-soft/60">
          Observability
        </p>
        <RunSummary latestRun={latestRun} observabilityRun={run} />
      </header>

      {/* Tabs */}
      <nav className="flex shrink-0 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              "flex-1 border-b-2 py-2 text-[11px] font-semibold uppercase tracking-wide transition-colors",
              tab === t.id
                ? "border-accent text-accent"
                : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "timeline" && <TimelineView events={events} run={run} />}
        {tab === "files"    && <SessionFilesTable files={files} />}
      </div>
    </div>
  );
}

const RUN_STATUS_BADGE: Record<string, string> = {
  queued:    "bg-surface-3 text-ink-muted",
  claimed:   "bg-warning/20 text-warning",
  running:   "bg-accent/20 text-accent animate-pulse",
  completed: "bg-success/20 text-success",
  error:     "bg-danger/20 text-danger",
};

function RunSummary({
  latestRun,
  observabilityRun,
}: {
  latestRun: ActiveRunData["latestRun"];
  observabilityRun: ActiveRunData["observabilityRun"];
}) {
  if (!latestRun) {
    return <p className="mt-1 text-[11px] text-ink-soft/50">No runs yet.</p>;
  }

  const duration =
    latestRun.startedAt && latestRun.completedAt
      ? formatDuration(latestRun.completedAt - latestRun.startedAt)
      : latestRun.startedAt
        ? "in progress"
        : "queued";

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-soft">
      <span
        className={clsx(
          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          RUN_STATUS_BADGE[latestRun.status] ?? "bg-surface-3 text-ink-muted",
        )}
      >
        {latestRun.status}
      </span>
      <span>{duration}</span>
      {latestRun.startedAt && <span>· {formatRelative(latestRun.startedAt)}</span>}
      {latestRun.error && (
        <span className="w-full text-[11px] text-danger/80">{latestRun.error}</span>
      )}
      {latestRun._id !== observabilityRun?._id && (
        <span className="w-full text-[10px] text-ink-soft/50">Showing previous run.</span>
      )}
    </div>
  );
}
