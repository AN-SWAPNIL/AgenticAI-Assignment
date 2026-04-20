import type { Doc, Id } from "../convex/_generated/dataModel";

export type Conversation = Doc<"conversations">;
export type Message = Doc<"messages">;
export type Run = Doc<"runs">;
export type ToolExecution = Doc<"toolExecutions">;
export type TimelineEvent = Doc<"timelineEvents">;
export type SessionFile = Doc<"sessionFiles">;

export type ConversationId = Id<"conversations">;
export type RunId = Id<"runs">;
export type MessageId = Id<"messages">;
export type SessionFileId = Id<"sessionFiles">;

export type ConversationStatus = Conversation["status"];
export type RunStatus = Run["status"];
export type MessageStatus = Message["status"];
export type SessionFileStatus = SessionFile["status"];

/** Message enriched with resolved session file records (files attached by the user). */
export interface MessageView extends Message {
  sessionFiles: SessionFileView[];
  thinkingContent?: string;
}

export interface SessionFileView extends SessionFile {
  downloadUrl: string | null;
}

/**
 * Inline observability slot type — used by InlineToolCard to render tool executions
 * interleaved with assistant text in the chat panel by chronological sequence.
 */
export interface InlineToolSlot {
  kind: "tool";
  execution: ToolExecution;
}

/**
 * thinking:
 *   "none"     — model does not support thinking at all (GPT-4o, GPT-4.1)
 *   "optional" — thinking can be toggled off or set to low/medium/high (Gemini 2.5, Claude)
 *   "required" — model always reasons; levels are minimal/low/medium/high, no "off" (GPT-5 reasoning)
 */
export const MODEL_OPTIONS = [
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: "google",    thinking: "none"     },
  { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash",      provider: "google",    thinking: "optional" },
  { id: "gemini-2.5-pro",        label: "Gemini 2.5 Pro",        provider: "google",    thinking: "optional" },
  { id: "claude-sonnet-4-6",     label: "Claude Sonnet 4.6",     provider: "anthropic", thinking: "optional" },
  { id: "claude-opus-4-7",       label: "Claude Opus 4.7",       provider: "anthropic", thinking: "optional" },
  { id: "gpt-4.1",               label: "GPT-4.1",               provider: "openai",    thinking: "none"     },
  { id: "gpt-4o",                label: "GPT-4o",                provider: "openai",    thinking: "none"     },
  { id: "gpt-5-nano",            label: "GPT-5 Nano",            provider: "openai",    thinking: "required" },
  { id: "gpt-5-mini",            label: "GPT-5 Mini",            provider: "openai",    thinking: "required" },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];
export type ModelThinking = (typeof MODEL_OPTIONS)[number]["thinking"];

/** Levels for "optional" thinking models (Gemini, Anthropic). */
export const THINKING_LEVELS_OPTIONAL = [
  { id: "off",    label: "Off"    },
  { id: "low",    label: "Low"    },
  { id: "medium", label: "Medium" },
  { id: "high",   label: "High"   },
] as const;

/** Levels for "required" thinking models (OpenAI o-series / GPT-5). No "off". */
export const THINKING_LEVELS_REQUIRED = [
  { id: "minimal", label: "Minimal" },
  { id: "low",     label: "Low"     },
  { id: "medium",  label: "Medium"  },
  { id: "high",    label: "High"    },
] as const;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";
