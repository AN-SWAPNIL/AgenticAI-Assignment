import clsx from "clsx";
import { useMemo, useState } from "react";
import { compactJson, formatClock, offsetFromStart, prettyJson } from "../../lib/formatters";
import type { Run, TimelineEvent } from "../../types";

interface TimelineViewProps {
  events: TimelineEvent[];
  run: Run | null | undefined;
}

const TYPE_TONE: Record<string, string> = {
  agent_start: "bg-accent",
  agent_complete: "bg-success",
  agent_error: "bg-danger",
  tool_execution_start: "bg-warning",
  tool_execution_end: "bg-success",
  message_update: "bg-ink-soft",
};

export function TimelineView({ events, run }: TimelineViewProps) {
  const sorted = useMemo(
    () => [...events].sort((a, b) => a.sequence - b.sequence),
    [events],
  );

  if (sorted.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-ink-soft">
        No telemetry yet. Send a message to populate the timeline.
      </p>
    );
  }

  const start = run?.startedAt ?? sorted[0]?.createdAt;

  return (
    <ol className="relative space-y-1 px-4 py-3">
      {sorted.map((event) => (
        <TimelineEntry key={event._id} event={event} runStart={start} />
      ))}
    </ol>
  );
}

function TimelineEntry({
  event,
  runStart,
}: {
  event: TimelineEvent;
  runStart: number | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = TYPE_TONE[event.type] ?? "bg-surface-3";
  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 rounded-md px-2 py-1 text-left hover:bg-surface-2"
      >
        <span
          className={clsx("mt-[6px] h-2 w-2 shrink-0 rounded-full", tone)}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[12px] text-ink">{event.type}</span>
            <span className="text-[10px] text-ink-soft">
              {offsetFromStart(event.createdAt, runStart)} · {formatClock(event.createdAt)}
            </span>
          </div>
          <p className="truncate font-mono text-[11px] text-ink-soft">
            {compactJson(event.payloadJson, 90)}
          </p>
        </div>
      </button>
      {expanded && (
        <pre className="ml-5 mb-2 max-h-64 overflow-auto rounded bg-surface-0 p-2 font-mono text-[10px] text-ink-muted">
          {prettyJson(event.payloadJson)}
        </pre>
      )}
    </li>
  );
}
