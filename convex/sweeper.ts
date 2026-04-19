"use node";

import { Daytona } from "@daytona/sdk";
import process from "node:process";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

/**
 * Hourly orphan sweeper (see crons.ts). Two passes:
 *   1. Convex side: any non-deleted conversation whose heartbeat is older than 2h is
 *      considered abandoned. We mark it deleted and let pass 2 free its sandbox.
 *   2. Daytona side: list all sandboxes labeled "agentic-assignment" and delete those
 *      whose conversationId no longer points at a live conversation row.
 *
 * Pass 2 catches sandboxes whose orchestrator delete-call failed (network blip, Daytona
 * 5xx). Without it those VMs would silently rack up usage.
 */

const STALE_HEARTBEAT_HOURS = 2;
const STALE_HEARTBEAT_MS = STALE_HEARTBEAT_HOURS * 60 * 60 * 1000;

export const sweepOrphans = internalAction({
  args: {},
  handler: async (ctx): Promise<{ markedAbandoned: number; sandboxesDeleted: number }> => {
    let markedAbandoned = 0;
    let sandboxesDeleted = 0;

    // Pass 1 — soft-delete stale conversations and tear down their sandboxes.
    const abandoned = await ctx.runQuery(internal.sweeperData.listAbandoned, {
      staleBefore: Date.now() - STALE_HEARTBEAT_MS,
    });
    for (const conv of abandoned) {
      await ctx.runMutation(internal.conversations.patchForOrchestrator, {
        conversationId: conv._id,
        patch: { status: "deleted" },
      });
      markedAbandoned += 1;
      try {
        await ctx.runAction(api.orchestrator.deleteConversationSandbox, {
          conversationId: conv._id,
        });
      } catch (err) {
        console.error("[sweeper] failed to delete sandbox for", conv._id, err);
      }
    }

    // Pass 2 — list Daytona sandboxes and delete any whose conversation row is dead/missing.
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) {
      console.warn("[sweeper] DAYTONA_API_KEY not set; skipping pass 2");
      return { markedAbandoned, sandboxesDeleted };
    }
    const daytona = new Daytona({ apiKey, target: "eu" });

    let sandboxes: Array<{ id: string; labels?: Record<string, string> }> = [];
    try {
      const list = await daytona.list();
      sandboxes = list.items.map((sandbox) => ({
        id: sandbox.id,
        labels: (sandbox as unknown as { labels?: Record<string, string> }).labels,
      }));
    } catch (err) {
      console.error("[sweeper] daytona.list() failed:", err);
      return { markedAbandoned, sandboxesDeleted };
    }

    const conversations = await ctx.runQuery(internal.sweeperData.listAllConversationIds, {});
    const liveConvIds = new Set(
      conversations.filter((c) => c.status !== "deleted").map((c) => c._id),
    );

    for (const sb of sandboxes) {
      const label = sb.labels?.app;
      const convId = sb.labels?.conversationId;
      if (label !== "agentic-assignment") continue;
      if (convId && liveConvIds.has(convId)) continue;
      try {
        const sandbox = await daytona.get(sb.id);
        await daytona.delete(sandbox);
        sandboxesDeleted += 1;
      } catch (err) {
        console.error("[sweeper] failed to delete sandbox", sb.id, err);
      }
    }

    return { markedAbandoned, sandboxesDeleted };
  },
});
