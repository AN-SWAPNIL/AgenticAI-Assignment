export const MAX_TEXT_CHARS = 16000;

export function truncateText(value: string, maxChars: number = MAX_TEXT_CHARS): string {
  if (value.length <= maxChars) return value;
  return value.slice(0, maxChars) + `\n... [truncated ${value.length - maxChars} chars]`;
}

export function safeJson(value: unknown): unknown {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(value, (_key, current) => {
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) return "[circular]";
        seen.add(current);
      }
      if (typeof current === "string" && current.length > 8000) {
        return truncateText(current, 8000);
      }
      return current;
    }),
  );
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

/**
 * Convert a glob pattern (*, **, ?) into a RegExp anchored to the full string.
 * Keeps the implementation dependency-free so the agent bundle stays small.
 */
export function globToRegExp(pattern: string): RegExp {
  const normalized = (pattern || "**/*").replace(/\\/g, "/");
  const tokenized = normalized
    .replace(/\*\*/g, "__DSTAR__")
    .replace(/\*/g, "__STAR__")
    .replace(/\?/g, "__Q__");
  const escaped = escapeRegExp(tokenized);
  const source =
    "^" +
    escaped
      .replace(/__DSTAR__/g, ".*")
      .replace(/__STAR__/g, "[^/]*")
      .replace(/__Q__/g, ".") +
    "$";
  return new RegExp(source);
}
