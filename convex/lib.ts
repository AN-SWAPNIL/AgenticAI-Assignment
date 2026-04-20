import type { Doc } from "./_generated/dataModel";

/**
 * Generate an opaque random token suitable for sharing with a sandbox daemon.
 * Uses crypto.getRandomValues for sufficient entropy; encoded as base36 for URL safety.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(36).padStart(2, "0");
  }
  return out;
}

/**
 * Verify that a candidate token matches expected. Constant-time-ish — not security-critical
 * since Convex terminates TLS and rate-limits, but avoids trivial timing leaks.
 */
export function tokensMatch(expected: string, candidate: string): boolean {
  if (expected.length !== candidate.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return diff === 0;
}

/** Pretty-default title for a new conversation before the user renames it. */
export function defaultConversationTitle(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Session ${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/**
 * Deterministic first-turn title from user text. Keeps titles short and stable without
 * spending extra tokens on an LLM title-generation step.
 */
export function deriveAutoTitleFromUserMessage(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) return defaultConversationTitle();
  const firstSentence = normalized.split(/[.!?\n]/, 1)[0]?.trim() || normalized;
  const cleaned = firstSentence.replace(/^[-*#>\s]+/, "").trim();
  const max = 56;
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 3).trimEnd()}...`;
}

export function fileBasename(candidate: string): string {
  const normalized = candidate.replace(/\\/g, "/");
  const tail = normalized.split("/").filter(Boolean).at(-1) ?? "file.bin";
  return tail.trim() || "file.bin";
}

export function sanitizeDisplayName(candidate: string): string {
  const base = fileBasename(candidate)
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();
  if (!base) return "file.bin";
  const bounded = base.slice(0, 120);
  return bounded || "file.bin";
}

export type ConversationDoc = Doc<"conversations">;
export type RunDoc = Doc<"runs">;
