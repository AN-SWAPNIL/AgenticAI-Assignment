import clsx from "clsx";
import type { Conversation } from "../../types";

interface StatusBarProps {
  conversation: Conversation | null | undefined;
}

const STATUS_COPY: Record<Conversation["status"], { label: string; tone: string }> = {
  provisioning: { label: "Provisioning", tone: "bg-warning text-surface-0" },
  idle: { label: "Idle", tone: "bg-success text-surface-0" },
  running: { label: "Running", tone: "bg-accent text-surface-0" },
  error: { label: "Error", tone: "bg-danger text-surface-0" },
  deleted: { label: "Deleted", tone: "bg-surface-3 text-ink-muted" },
};

export function StatusBar({ conversation }: StatusBarProps) {
  const status = conversation?.status;
  const lastError = conversation?.lastError;
  const tone = status ? STATUS_COPY[status] : null;

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-surface-1 px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
          <img src="/pi-icon.svg" alt="Smart Pi Assistant" className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-ink">Smart Pi Assistant</p>
          <p className="hidden truncate text-[11px] text-ink-soft sm:block">
            Isolated Daytona workspace per chat
          </p>
        </div>
      </div>

      {tone ? (
        <div className="relative group shrink-0">
          <span
            className={clsx(
              "rounded-full px-2 py-[3px] text-[11px] font-medium uppercase tracking-wide",
              tone.tone,
            )}
            title={lastError ?? undefined}
          >
            {tone.label}
          </span>
          {lastError ? (
            <div className="absolute bottom-full right-0 z-50 mb-1.5 hidden max-w-xs rounded-md border border-border bg-surface-0 px-2 py-1 text-[11px] text-danger shadow-lg group-hover:block">
              {lastError}
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
