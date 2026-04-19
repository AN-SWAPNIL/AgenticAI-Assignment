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
