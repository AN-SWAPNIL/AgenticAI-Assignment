import clsx from "clsx";
import { useState } from "react";
import { compactJson, formatDuration, prettyJson } from "../../lib/formatters";
import type { ToolExecution } from "../../types";

interface InlineToolCallProps {
  execution: ToolExecution;
}

const STATUS_ICON: Record<ToolExecution["status"], string> = {
  running: "⋯",
  success: "✓",
  error: "✕",
};

const STATUS_TONE: Record<ToolExecution["status"], string> = {
  running: "bg-warning/20 text-warning",
  success: "bg-success/20 text-success",
  error: "bg-danger/20 text-danger",
};

export function InlineToolCall({ execution }: InlineToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const compactInput = compactJson(execution.inputJson, 70);

  return (
    <div className="my-2 rounded-md border border-border bg-surface-1 text-[13px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2"
      >
        <span
          className={clsx(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px]",
            STATUS_TONE[execution.status],
          )}
        >
          {STATUS_ICON[execution.status]}
        </span>
        <span className="font-mono text-[12px] font-semibold text-ink">
          {execution.toolName}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft">
          {compactInput}
        </span>
        <span className="shrink-0 text-[11px] text-ink-soft">
          {formatDuration(execution.durationMs)}
        </span>
        <span className="shrink-0 text-[11px] text-ink-soft">
          {expanded ? "▴" : "▾"}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <Section label="Input">
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-ink">
              {prettyJson(execution.inputJson)}
            </pre>
          </Section>
          {execution.outputText && (
            <Section label="Output">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-muted">
                {tryPretty(execution.outputText)}
              </pre>
            </Section>
          )}
          {execution.errorText && (
            <Section label="Error">
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-danger">
                {tryPretty(execution.errorText)}
              </pre>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </p>
      {children}
    </div>
  );
}

function tryPretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
