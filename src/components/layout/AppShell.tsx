import { useState, type ReactNode } from "react";
import clsx from "clsx";

interface AppShellProps {
  statusBar: ReactNode;
  sidebar: ReactNode;
  chat: ReactNode;
  observability: ReactNode;
}

export function AppShell({ statusBar, sidebar, chat, observability }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [obsOpen, setObsOpen] = useState(true);

  return (
    <div className="flex h-full flex-col bg-surface-0">
      {statusBar}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Left sidebar ───────────────────────────────────────────── */}
        <aside
          className={clsx(
            "flex shrink-0 flex-col border-r border-border bg-surface-1 transition-[width] duration-200 ease-in-out overflow-hidden",
            sidebarOpen ? "w-56" : "w-0",
          )}
        >
          <div className="w-56 flex h-full flex-col">
            {sidebar}
          </div>
        </aside>

        {/* Sidebar toggle tab */}
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          className="z-10 flex w-4 shrink-0 items-center justify-center self-stretch border-r border-border bg-surface-1 text-ink-soft/40 hover:bg-surface-2 hover:text-ink-soft transition-colors"
        >
          <span className="text-[10px] select-none">{sidebarOpen ? "‹" : "›"}</span>
        </button>

        {/* ── Chat ───────────────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col">{chat}</main>

        {/* Observability toggle tab */}
        <button
          type="button"
          onClick={() => setObsOpen((v) => !v)}
          title={obsOpen ? "Collapse observability" : "Expand observability"}
          className="z-10 flex w-4 shrink-0 items-center justify-center self-stretch border-l border-border bg-surface-1 text-ink-soft/40 hover:bg-surface-2 hover:text-ink-soft transition-colors"
        >
          <span className="text-[10px] select-none">{obsOpen ? "›" : "‹"}</span>
        </button>

        {/* ── Right observability ─────────────────────────────────────── */}
        <aside
          className={clsx(
            "flex shrink-0 flex-col border-l border-border bg-surface-1 transition-[width] duration-200 ease-in-out overflow-hidden",
            obsOpen ? "w-[26rem]" : "w-0",
          )}
        >
          <div className="w-[26rem] flex h-full flex-col">
            {observability}
          </div>
        </aside>
      </div>
    </div>
  );
}
