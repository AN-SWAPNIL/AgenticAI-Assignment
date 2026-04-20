import clsx from "clsx";
import { useMutation } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Conversation, ModelId, ThinkingLevel } from "../../types";
import {
  MODEL_OPTIONS,
  THINKING_LEVELS_OPTIONAL,
  THINKING_LEVELS_REQUIRED,
} from "../../types";

interface SidebarSettingsProps {
  conversation: Conversation | null | undefined;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

const DEFAULT_MODEL: ModelId = "gemini-2.5-flash";

function normalizeThinkingForModel(modelId: string, thinkingLevel: string | undefined): ThinkingLevel {
  const mode = MODEL_OPTIONS.find((option) => option.id === modelId)?.thinking ?? "optional";
  const level = (thinkingLevel ?? "off") as ThinkingLevel;

  if (mode === "none") return "off";
  if (mode === "required") {
    return level === "off" ? "minimal" : level;
  }
  if (level === "minimal") return "low";
  return level;
}

export function SidebarSettings({ conversation, theme, onToggleTheme }: SidebarSettingsProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const setModel = useMutation(api.conversations.setModel);
  const setThinkingLevel = useMutation(api.conversations.setThinkingLevel);

  const activeModel = (conversation?.modelId?.trim() as ModelId | undefined) || DEFAULT_MODEL;
  const modelMeta = MODEL_OPTIONS.find((option) => option.id === activeModel) ?? MODEL_OPTIONS[1];
  const activeThinking = normalizeThinkingForModel(activeModel, conversation?.thinkingLevel);

  const thinkingOptions = useMemo(() => {
    if (modelMeta.thinking === "none") return [{ id: "off", label: "Off" }] as const;
    if (modelMeta.thinking === "required") return THINKING_LEVELS_REQUIRED;
    return THINKING_LEVELS_OPTIONAL;
  }, [modelMeta.thinking]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const applyModel = async (nextModelId: string) => {
    if (!conversation) return;
    setSaving(true);
    try {
      await setModel({ conversationId: conversation._id, modelId: nextModelId });
      const normalizedThinking = normalizeThinkingForModel(nextModelId, conversation.thinkingLevel);
      if (normalizedThinking !== (conversation.thinkingLevel ?? "off")) {
        await setThinkingLevel({
          conversationId: conversation._id,
          thinkingLevel: normalizedThinking,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const applyThinking = async (nextThinkingLevel: string) => {
    if (!conversation) return;
    setSaving(true);
    try {
      await setThinkingLevel({
        conversationId: conversation._id,
        thinkingLevel: normalizeThinkingForModel(activeModel, nextThinkingLevel),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {open ? (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-xl border border-border bg-surface-1 p-3 shadow-xl">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft/75">Settings</p>

          <div className="mt-3 space-y-3">
            <div>
              <p className="text-[11px] text-ink-soft">Theme</p>
              <button
                type="button"
                onClick={onToggleTheme}
                className="mt-1.5 w-full rounded-md border border-border bg-surface-0 px-2.5 py-2 text-left text-[12px] text-ink hover:bg-surface-2"
              >
                {theme === "dark" ? "Dark mode" : "Light mode"}
              </button>
            </div>

            <div>
              <label htmlFor="settings-model" className="text-[11px] text-ink-soft">
                Model
              </label>
              <select
                id="settings-model"
                value={activeModel}
                disabled={!conversation || saving}
                onChange={(event) => {
                  void applyModel(event.target.value);
                }}
                className={clsx(
                  "mt-1.5 w-full rounded-md border border-border bg-surface-0 px-2.5 py-2 text-[12px] text-ink outline-none focus:border-accent",
                  (!conversation || saving) && "cursor-not-allowed opacity-60",
                )}
              >
                {MODEL_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="settings-thinking" className="text-[11px] text-ink-soft">
                Thinking
              </label>
              <select
                id="settings-thinking"
                value={activeThinking}
                disabled={!conversation || saving || modelMeta.thinking === "none"}
                onChange={(event) => {
                  void applyThinking(event.target.value);
                }}
                className={clsx(
                  "mt-1.5 w-full rounded-md border border-border bg-surface-0 px-2.5 py-2 text-[12px] text-ink outline-none focus:border-accent",
                  (!conversation || saving || modelMeta.thinking === "none") &&
                    "cursor-not-allowed opacity-60",
                )}
              >
                {thinkingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="mt-3 text-[10px] text-ink-soft/65">
            Settings are applied per conversation and used for the next run.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-ink hover:bg-surface-2"
      >
        <span>Settings</span>
        <span className="text-[10px] text-ink-soft">{open ? "Close" : "Open"}</span>
      </button>
    </div>
  );
}
