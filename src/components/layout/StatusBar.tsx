import clsx from "clsx";
import { formatRelative } from "../../lib/formatters";
import type { Conversation } from "../../types";

interface StatusBarProps {
  conversation: Conversation | null | undefined;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

const STATUS_COPY: Record<Conversation["status"], { label: string; tone: string }> = {
  provisioning: { label: "Provisioning sandbox", tone: "bg-warning text-surface-0" },
  idle: { label: "Idle", tone: "bg-success text-surface-0" },
  running: { label: "Agent running", tone: "bg-accent text-surface-0" },
  error: { label: "Error", tone: "bg-danger text-surface-0" },
  deleted: { label: "Deleted", tone: "bg-surface-3 text-ink-muted" },
};

export function StatusBar({ conversation, theme, onToggleTheme }: StatusBarProps) {
  const status = conversation?.status;
  const heartbeat = conversation?.lastHeartbeatAt;
  const sandboxId = conversation?.sandboxId;
  const tone = status ? STATUS_COPY[status] : null;

  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b border-border bg-surface-1 px-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tracking-tight">
          Pi Agent
          <span className="ml-1 text-ink-muted font-normal">· isolated sandbox chatbot</span>
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-ink-muted">
        {tone && (
          <span
            className={clsx(
              "rounded-full px-2 py-[3px] text-[11px] font-medium uppercase tracking-wide",
              tone.tone,
            )}
          >
            {tone.label}
          </span>
        )}
        {sandboxId && (
          <span className="font-mono text-[11px] text-ink-soft">
            sandbox {sandboxId.slice(0, 12)}…
          </span>
        )}
        {heartbeat ? (
          <span className="hidden md:inline">heartbeat {formatRelative(heartbeat)}</span>
        ) : null}
        <span className="hidden lg:inline">model gemini-2.5-flash</span>

        <button
          type="button"
          onClick={onToggleTheme}
          className="rounded-md border border-border px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted hover:bg-surface-2"
          aria-label="Toggle theme"
          title="Toggle theme (⌘⇧J)"
        >
          {theme === "dark" ? "Dark" : "Light"}
        </button>
      </div>
    </header>
  );
}
