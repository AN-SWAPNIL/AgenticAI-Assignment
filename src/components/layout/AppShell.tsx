import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";

interface AppShellProps {
  statusBar: ReactNode;
  sidebar: ReactNode;
  chat: ReactNode;
  observability: ReactNode;
}

type PanelMode = "full" | "compact" | "hidden";

const SIDEBAR_MODE_KEY = "smart-pi-assistant:left-panel-mode";
const OBS_MODE_KEY = "smart-pi-assistant:right-panel-mode";

const SIDEBAR_WIDTH_CLASS: Record<PanelMode, string> = {
  full: "w-[80vw] max-w-72 md:w-72",
  compact: "w-[68vw] max-w-56 md:w-56",
  hidden: "w-0",
};

const OBS_WIDTH_CLASS: Record<PanelMode, string> = {
  full: "w-[86vw] max-w-[30rem] md:w-[30rem]",
  compact: "w-[74vw] max-w-[22rem] md:w-[22rem]",
  hidden: "w-0",
};

function readPanelMode(key: string, fallback: PanelMode): PanelMode {
  try {
    const stored = localStorage.getItem(key);
    if (stored === "full" || stored === "compact" || stored === "hidden") {
      return stored;
    }
  } catch {
    // Ignore localStorage errors and use fallback.
  }
  return fallback;
}

function nextMode(mode: PanelMode): PanelMode {
  if (mode === "full") return "compact";
  if (mode === "compact") return "hidden";
  return "full";
}

function modeLabel(mode: PanelMode): string {
  if (mode === "full") return "F";
  if (mode === "compact") return "C";
  return "H";
}

function nextModeLabel(mode: PanelMode): string {
  if (mode === "full") return "compact";
  if (mode === "compact") return "hidden";
  return "full";
}

export function AppShell({ statusBar, sidebar, chat, observability }: AppShellProps) {
  const [sidebarMode, setSidebarMode] = useState<PanelMode>(() =>
    readPanelMode(SIDEBAR_MODE_KEY, "full"),
  );
  const [obsMode, setObsMode] = useState<PanelMode>(() =>
    readPanelMode(OBS_MODE_KEY, "full"),
  );

  useEffect(() => {
    localStorage.setItem(SIDEBAR_MODE_KEY, sidebarMode);
  }, [sidebarMode]);

  useEffect(() => {
    localStorage.setItem(OBS_MODE_KEY, obsMode);
  }, [obsMode]);

  return (
    <div className="flex h-full flex-col bg-surface-0">
      {statusBar}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={clsx(
            "flex shrink-0 flex-col border-r border-border bg-surface-1 transition-[width] duration-200 ease-in-out overflow-hidden",
            SIDEBAR_WIDTH_CLASS[sidebarMode],
          )}
        >
          <div className="flex h-full w-full min-w-0 flex-col">{sidebar}</div>
        </aside>

        <button
          type="button"
          onClick={() => setSidebarMode((mode) => nextMode(mode))}
          title={`Left panel: ${sidebarMode}. Click to ${nextModeLabel(sidebarMode)}.`}
          className="z-10 flex w-6 shrink-0 items-center justify-center self-stretch border-r border-border bg-surface-1 text-[10px] font-semibold tracking-wide text-ink-soft/50 hover:bg-surface-2 hover:text-ink-soft transition-colors md:w-5"
        >
          <span className="select-none">{modeLabel(sidebarMode)}</span>
        </button>

        <main className="flex min-w-0 flex-1 flex-col bg-surface-0">{chat}</main>

        <button
          type="button"
          onClick={() => setObsMode((mode) => nextMode(mode))}
          title={`Right panel: ${obsMode}. Click to ${nextModeLabel(obsMode)}.`}
          className="z-10 flex w-6 shrink-0 items-center justify-center self-stretch border-l border-border bg-surface-1 text-[10px] font-semibold tracking-wide text-ink-soft/50 hover:bg-surface-2 hover:text-ink-soft transition-colors md:w-5"
        >
          <span className="select-none">{modeLabel(obsMode)}</span>
        </button>

        <aside
          className={clsx(
            "flex shrink-0 flex-col border-l border-border bg-surface-1 transition-[width] duration-200 ease-in-out overflow-hidden",
            OBS_WIDTH_CLASS[obsMode],
          )}
        >
          <div className="flex h-full w-full min-w-0 flex-col">{observability}</div>
        </aside>
      </div>
    </div>
  );
}
