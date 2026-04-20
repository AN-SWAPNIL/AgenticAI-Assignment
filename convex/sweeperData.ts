import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";

export const listAbandoned = internalQuery({
  args: { staleBefore: v.number() },
  handler: async (ctx, { staleBefore }): Promise<Doc<"conversations">[]> => {
    const all = await ctx.db.query("conversations").take(500);
    return all.filter((conversation) => {
      if (conversation.status === "deleted") return false;
      if (!conversation.lastHeartbeatAt) return conversation.createdAt < staleBefore;
      return conversation.lastHeartbeatAt < staleBefore;
    });
  },
});

/** Find conversations stuck in "running" with a stale heartbeat — daemon crashed mid-run. */
export const listStaleRunning = internalQuery({
  args: { staleBefore: v.number() },
  handler: async (ctx, { staleBefore }): Promise<Doc<"conversations">[]> => {
    return ctx.db
      .query("conversations")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .filter((q) => q.lt(q.field("lastHeartbeatAt"), staleBefore))
      .take(50);
  },
});

export const listAllConversationIds = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<Array<{ _id: string; sandboxId?: string; status: string }>> => {
    const rows = await ctx.db.query("conversations").collect();
    return rows.map((row) => ({
      _id: String(row._id),
      sandboxId: row.sandboxId,
      status: row.status,
    }));
  },
});
