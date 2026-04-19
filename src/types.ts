import type { Doc, Id } from "../convex/_generated/dataModel";

export type Conversation = Doc<"conversations">;
export type Message = Doc<"messages">;
export type Run = Doc<"runs">;
export type ToolExecution = Doc<"toolExecutions">;
export type TimelineEvent = Doc<"timelineEvents">;

export type ConversationId = Id<"conversations">;
export type RunId = Id<"runs">;
export type MessageId = Id<"messages">;

export type ConversationStatus = Conversation["status"];
export type RunStatus = Run["status"];
export type MessageStatus = Message["status"];

/**
 * Inline observability slot type — used by InlineToolCard to render tool executions
 * interleaved with assistant text in the chat panel by chronological sequence.
 */
export interface InlineToolSlot {
  kind: "tool";
  execution: ToolExecution;
}
