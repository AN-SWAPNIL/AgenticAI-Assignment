import clsx from "clsx";
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { formatRelative } from "../../lib/formatters";
import {
  MODEL_OPTIONS,
  THINKING_LEVELS_OPTIONAL,
  THINKING_LEVELS_REQUIRED,
  type Conversation,
  type ConversationId,
  type ModelId,
  type ThinkingLevel,
} from "../../types";

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

const STALE_HEARTBEAT_MS = 20_000;

export function StatusBar({ conversation, theme, onToggleTheme }: StatusBarProps) {
  const setModel = useMutation(api.conversations.setModel);
  const setThinkingLevel = useMutation(api.conversations.setThinkingLevel);
  const revive = useMutation(api.conversations.revive);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const thinkingMenuRef = useRef<HTMLDivElement>(null);

  const status = conversation?.status;
  const heartbeat = conversation?.lastHeartbeatAt;
  const sandboxId = conversation?.sandboxId;
  const lastError = conversation?.lastError;
  const conversationId = conversation?._id as ConversationId | undefined;

  const currentModelId = (conversation?.modelId ?? "gemini-2.5-flash") as ModelId;
  const currentModel = MODEL_OPTIONS.find((m) => m.id === currentModelId) ?? MODEL_OPTIONS[1];
  const modelThinking = currentModel.thinking;

  // Resolve stored level to a valid value for this model
  const storedLevel = (conversation?.thinkingLevel ?? undefined) as ThinkingLevel | undefined;
  const currentThinkingLevel: ThinkingLevel = (() => {
    if (modelThinking === "none") return "off";
    if (modelThinking === "required") {
      // "off" is invalid for required-thinking models → default to "minimal"
      if (!storedLevel || storedLevel === "off") return "minimal";
      return storedLevel;
    }
    // optional
    return storedLevel ?? "off";
  })();

  const thinkingLevels = modelThinking === "required" ? THINKING_LEVELS_REQUIRED : THINKING_LEVELS_OPTIONAL;
  const thinkingLabel = thinkingLevels.find((t) => t.id === currentThinkingLevel)?.label
    ?? (modelThinking === "required" ? "Minimal" : "Off");

  const isStaleRunning =
    status === "running" &&
    heartbeat !== undefined &&
    Date.now() - heartbeat > STALE_HEARTBEAT_MS;

  const tone = status
    ? isStaleRunning
      ? { label: "Reviving…", tone: "bg-warning text-surface-0 animate-pulse" }
      : STATUS_COPY[status]
    : null;

  const handleSetModel = async (modelId: ModelId) => {
    setModelMenuOpen(false);
    if (!conversationId) return;
    await setModel({ conversationId, modelId });
    void revive({ conversationId });
  };

  const handleSetThinking = async (level: ThinkingLevel) => {
    setThinkingMenuOpen(false);
    if (!conversationId) return;
    await setThinkingLevel({ conversationId, thinkingLevel: level });
    void revive({ conversationId });
  };

  return (
    <header className="flex h-12 items-center justify-between gap-4 border-b border-border bg-surface-1 px-4">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tracking-tight">
          Pi Agent
          <span className="ml-1 font-normal text-ink-muted">· isolated sandbox chatbot</span>
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-ink-muted">
        {/* Status badge */}
        {tone && (
          <div className="relative group">
            <span
              className={clsx(
                "rounded-full px-2 py-[3px] text-[11px] font-medium uppercase tracking-wide cursor-default",
                tone.tone,
              )}
              title={lastError ?? undefined}
            >
              {tone.label}
            </span>
            {lastError && (
              <div className="absolute bottom-full left-1/2 mb-1.5 hidden -translate-x-1/2 max-w-xs rounded-md border border-border bg-surface-0 px-2 py-1 text-[11px] text-danger shadow-lg group-hover:block z-50 whitespace-nowrap">
                {lastError}
              </div>
            )}
          </div>
        )}

        {sandboxId && (
          <span className="hidden font-mono text-[11px] text-ink-soft md:inline">
            sandbox {sandboxId.slice(0, 12)}…
          </span>
        )}

        {heartbeat ? (
          <span className="hidden md:inline">heartbeat {formatRelative(heartbeat)}</span>
        ) : null}

        {/* Thinking selector — only for models that support it */}
        {modelThinking !== "none" && (
          <div ref={thinkingMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setThinkingMenuOpen((v) => !v)}
              disabled={!conversationId}
              title="Thinking / reasoning budget"
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-ink-muted hover:bg-surface-2 disabled:opacity-50"
            >
              <span className={clsx("h-1.5 w-1.5 rounded-full", thinkingDot(currentThinkingLevel))} />
              {thinkingLabel}
              <span className="text-[9px]">▾</span>
            </button>

            {thinkingMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-surface-0 py-1 shadow-xl">
                <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft/60">
                  Thinking Budget
                </div>
                {thinkingLevels.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { void handleSetThinking(t.id as ThinkingLevel); }}
                    className={clsx(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-surface-2",
                      t.id === currentThinkingLevel ? "font-semibold text-accent" : "text-ink",
                    )}
                  >
                    <span className={clsx("h-2 w-2 rounded-full shrink-0", thinkingDot(t.id))} />
                    <span className="flex-1">{t.label}</span>
                    {t.id === currentThinkingLevel && <span className="text-[10px] text-accent">✓</span>}
                  </button>
                ))}
                <div className="border-t border-border mt-1 px-3 py-1.5 text-[10px] text-ink-soft/60">
                  Auto-restarts daemon on change.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Model selector */}
        <div ref={modelMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setModelMenuOpen((v) => !v)}
            disabled={!conversationId}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-ink-muted hover:bg-surface-2 disabled:opacity-50"
          >
            <span className={clsx("h-1.5 w-1.5 rounded-full", providerDot(currentModel.provider))} />
            {currentModel.label}
            <span className="text-[9px]">▾</span>
          </button>

          {modelMenuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-border bg-surface-0 py-1 shadow-xl">
              {MODEL_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { void handleSetModel(m.id); }}
                  className={clsx(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-surface-2",
                    m.id === currentModelId ? "font-semibold text-accent" : "text-ink",
                  )}
                >
                  <span className={clsx("h-2 w-2 rounded-full shrink-0", providerDot(m.provider))} />
                  <span className="flex-1">{m.label}</span>
                  <span className={clsx("text-[10px] shrink-0", thinkingBadgeColor(m.thinking))}>
                    {thinkingBadgeLabel(m.thinking)}
                  </span>
                  {m.id === currentModelId && <span className="text-[10px] text-accent">✓</span>}
                </button>
              ))}
              <div className="border-t border-border mt-1 px-3 py-1.5 text-[10px] text-ink-soft/60">
                Auto-restarts daemon on change.
              </div>
            </div>
          )}
        </div>

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

function providerDot(provider: string): string {
  if (provider === "google") return "bg-blue-400";
  if (provider === "anthropic") return "bg-orange-400";
  if (provider === "openai") return "bg-green-400";
  return "bg-surface-3";
}

function thinkingDot(level: string): string {
  if (level === "off") return "bg-surface-3";
  if (level === "minimal") return "bg-blue-200";
  if (level === "low") return "bg-blue-300";
  if (level === "medium") return "bg-yellow-400";
  if (level === "high") return "bg-orange-400";
  return "bg-surface-3";
}

function thinkingBadgeLabel(thinking: string): string {
  if (thinking === "none") return "no thinking";
  if (thinking === "required") return "reasoning";
  return "thinking";
}

function thinkingBadgeColor(thinking: string): string {
  if (thinking === "none") return "text-ink-soft/40";
  if (thinking === "required") return "text-green-500/70";
  return "text-yellow-500/70";
}
