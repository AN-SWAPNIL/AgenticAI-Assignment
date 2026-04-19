import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Conversation } from "../types";

export function useConversations(): Conversation[] | undefined {
  return useQuery(api.conversations.list, {});
}
