import { useMemo } from "react";
import type { TimelineEvent } from "../../types";

interface RawEventsDrawerProps {
  events: TimelineEvent[];
}

export function RawEventsDrawer({ events }: RawEventsDrawerProps) {
  const text = useMemo(() => {
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    return sorted
      .map((e) => {
        let payload = e.payloadJson;
        try {
          payload = JSON.stringify(JSON.parse(e.payloadJson), null, 2);
        } catch {
          /* keep raw */
        }
        return `[${e.sequence}] ${e.type}\n${payload}`;
      })
      .join("\n\n");
  }, [events]);

  if (events.length === 0) {
    return <p className="px-4 py-6 text-sm text-ink-soft">No raw events yet.</p>;
  }

  return (
    <pre className="max-h-full overflow-auto bg-surface-0 px-4 py-3 font-mono text-[10px] text-ink-muted">
      {text}
    </pre>
  );
}
