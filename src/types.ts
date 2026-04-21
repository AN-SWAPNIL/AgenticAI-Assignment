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

export interface MessageView extends Message {
  sessionFiles: SessionFileView[];
  thinkingContent?: string;
}

export interface SessionFileView extends SessionFile {
  downloadUrl: string | null;
}

/**
 * thinking:
 *   "none"     - model ignores thinking controls
 *   "optional" - thinking can be off/low/medium/high
 *   "required" - model requires reasoning level (minimal/low/medium/high)
 */
export const MODEL_OPTIONS = [
  { id: "gpt-4.1", label: "GPT-4.1", provider: "openai", thinking: "none" },
  { id: "gpt-4o", label: "GPT-4o", provider: "openai", thinking: "none" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", provider: "openai", thinking: "required" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", provider: "openai", thinking: "required" },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];
export type ModelThinking = (typeof MODEL_OPTIONS)[number]["thinking"];

export const THINKING_LEVELS_OPTIONAL = [
  { id: "off", label: "Off" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
] as const;

export const THINKING_LEVELS_REQUIRED = [
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
] as const;

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";
