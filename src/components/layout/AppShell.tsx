import type { ReactNode } from "react";

interface AppShellProps {
  statusBar: ReactNode;
  sidebar: ReactNode;
  chat: ReactNode;
  observability: ReactNode;
}

/**
 * Three-pane shell. Sidebar | Chat | Observability — fixed width on left, flexible center,
 * fixed right. Collapses gracefully on narrower viewports by stacking observability under chat.
 */
export function AppShell({ statusBar, sidebar, chat, observability }: AppShellProps) {
  return (
    <div className="flex h-full flex-col">
      {statusBar}
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-surface-1 lg:flex lg:flex-col">
          {sidebar}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-surface-0">{chat}</main>
        <aside className="hidden w-[28rem] shrink-0 border-l border-border bg-surface-1 xl:flex xl:flex-col">
          {observability}
        </aside>
      </div>
    </div>
  );
}
