import { useEffect } from "react";

export interface ShortcutHandlers {
  onNewConversation?: () => void;
  onFocusComposer?: () => void;
  onToggleTheme?: () => void;
}

/**
 * Wires global shortcuts to the document. Returns nothing — handlers should be stable
 * references (memoized in the parent), otherwise we'd re-bind on every render.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "k" && handlers.onNewConversation) {
        event.preventDefault();
        handlers.onNewConversation();
      } else if (key === "/" && handlers.onFocusComposer) {
        event.preventDefault();
        handlers.onFocusComposer();
      } else if (key === "j" && event.shiftKey && handlers.onToggleTheme) {
        event.preventDefault();
        handlers.onToggleTheme();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handlers.onNewConversation, handlers.onFocusComposer, handlers.onToggleTheme]);
}
