import { format, formatDistanceToNowStrict } from "date-fns";

export function formatRelative(timestamp: number | undefined | null): string {
  if (!timestamp) return "—";
  const distance = formatDistanceToNowStrict(new Date(timestamp), {
    addSuffix: true,
  });
  return distance;
}

export function formatClock(timestamp: number | undefined | null): string {
  if (!timestamp) return "—";
  return format(new Date(timestamp), "HH:mm:ss");
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = ((ms % 60_000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

export function formatBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function offsetFromStart(at: number, runStart: number | undefined): string {
  if (!runStart) return "+0.00s";
  const delta = Math.max(0, at - runStart) / 1000;
  return `+${delta.toFixed(2)}s`;
}

export function prettyJson(raw: string | undefined | null): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function compactJson(raw: string | undefined | null, max = 80): string {
  if (!raw) return "";
  try {
    const value = JSON.parse(raw);
    const compact = JSON.stringify(value);
    return compact.length > max ? compact.slice(0, max) + "…" : compact;
  } catch {
    return raw.length > max ? raw.slice(0, max) + "…" : raw;
  }
}
