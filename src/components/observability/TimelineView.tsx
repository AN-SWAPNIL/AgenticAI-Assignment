import clsx from "clsx";
import { useMemo, useState } from "react";
import { compactJson, formatDuration, offsetFromStart, prettyJson } from "../../lib/formatters";
import type { Run, TimelineEvent } from "../../types";

interface TimelineViewProps {
  events: TimelineEvent[];
  run: Run | null | undefined;
}

// Events too noisy to show individually — filtered within turns
const SKIP_TYPES = new Set(["text_delta", "input_delta", "thinking_delta", "message_update"]);

const TYPE_DOT: Record<string, string> = {
  agent_start: "bg-accent",
  agent_complete: "bg-success",
  agent_error: "bg-danger",
  agent_end: "bg-ink-soft",
  tool_execution_start: "bg-warning",
  tool_execution_end: "bg-success",
  turn_start: "bg-accent/50",
  turn_end: "bg-accent/50",
  message_start: "bg-ink-soft/60",
  message_end: "bg-ink-soft/60",
  history_summarized: "bg-warning/70",
  agent_retry: "bg-warning",
};

interface Turn {
  index: number;
  startAt: number | undefined;
  endAt: number | undefined;
  events: TimelineEvent[];
}

function groupIntoTurns(sorted: TimelineEvent[]): { preamble: TimelineEvent[]; turns: Turn[]; epilogue: TimelineEvent[] } {
  const preamble: TimelineEvent[] = [];
  const turns: Turn[] = [];
  const epilogue: TimelineEvent[] = [];
  let currentTurn: Turn | null = null;
  let turnIndex = 0;

  for (const ev of sorted) {
    if (ev.type === "turn_start") {
      currentTurn = { index: turnIndex++, startAt: ev.createdAt, endAt: undefined, events: [ev] };
      turns.push(currentTurn);
    } else if (ev.type === "turn_end") {
      if (currentTurn) {
        currentTurn.endAt = ev.createdAt;
        currentTurn.events.push(ev);
        currentTurn = null;
      } else {
        epilogue.push(ev);
      }
    } else if (currentTurn) {
      currentTurn.events.push(ev);
    } else if (turns.length === 0) {
      preamble.push(ev);
    } else {
      epilogue.push(ev);
    }
  }

  return { preamble, turns, epilogue };
}

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

  const runStart = run?.startedAt ?? sorted[0]?.createdAt;
  const { preamble, turns, epilogue } = groupIntoTurns(sorted);
  const hasTurns = turns.length > 0;

  return (
    <div className="px-3 py-2 space-y-1">
      {/* Preamble events (agent_start etc.) */}
      {preamble.map((ev) => (
        <EventRow key={ev._id} event={ev} runStart={runStart} />
      ))}

      {/* Turns — each collapsible, last one open by default */}
      {turns.map((turn, i) => (
        <TurnGroup
          key={turn.index}
          turn={turn}
          runStart={runStart}
          defaultOpen={i === turns.length - 1}
        />
      ))}

      {/* Epilogue (agent_complete / agent_error / agent_end) */}
      {epilogue
        .filter((ev) => !SKIP_TYPES.has(ev.type))
        .map((ev) => (
          <EventRow key={ev._id} event={ev} runStart={runStart} indent={hasTurns} />
        ))}
    </div>
  );
}

function TurnGroup({ turn, runStart, defaultOpen }: { turn: Turn; runStart: number | undefined; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const visibleEvents = turn.events.filter((ev) => !SKIP_TYPES.has(ev.type));
  const toolCount = visibleEvents.filter((ev) => ev.type === "tool_execution_start").length;
  const duration = turn.startAt && turn.endAt ? turn.endAt - turn.startAt : undefined;

  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      {/* Turn header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left bg-surface-2/60 hover:bg-surface-2 transition-colors"
      >
        <span className="text-[10px] text-ink-soft/70">{open ? "▾" : "▸"}</span>
        <span className="text-[12px] font-medium text-ink">Turn {turn.index + 1}</span>
        <span className="text-[10px] text-ink-soft">
          · {visibleEvents.length} event{visibleEvents.length !== 1 ? "s" : ""}
          {toolCount > 0 && ` · ${toolCount} tool call${toolCount !== 1 ? "s" : ""}`}
          {duration !== undefined && ` · ${formatDuration(duration)}`}
        </span>
        {turn.startAt && (
          <span className="ml-auto text-[10px] text-ink-soft/60">
            {offsetFromStart(turn.startAt, runStart)}
          </span>
        )}
      </button>

      {/* Turn events */}
      {open && (
        <div className="py-1">
          {visibleEvents.map((ev) => (
            <EventRow key={ev._id} event={ev} runStart={runStart} indent />
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, runStart, indent }: { event: TimelineEvent; runStart: number | undefined; indent?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const dot = TYPE_DOT[event.type] ?? "bg-surface-3";

  return (
    <div className={indent ? "ml-1" : undefined}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-surface-2 transition-colors"
      >
        <span className={clsx("mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full", dot)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-ink">{event.type}</span>
            <span className="text-[10px] text-ink-soft">
              {offsetFromStart(event.createdAt, runStart)}
            </span>
          </div>
          <p className="truncate font-mono text-[10px] text-ink-soft/70">
            {compactJson(event.payloadJson, 80)}
          </p>
        </div>
        <span className="mt-0.5 shrink-0 text-[9px] text-ink-soft/40">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <pre className="mx-2 mb-1 max-h-56 overflow-auto rounded bg-surface-0 p-2 font-mono text-[10px] text-ink-muted border border-border/40">
          {prettyJson(event.payloadJson)}
        </pre>
      )}
    </div>
  );
}
