import { ConvexBridge } from "./convexBridge.js";
import { api } from "./convexApi.js";
import { Workspace } from "./workspace.js";
import { processRun } from "./runLoop.js";

/**
 * In-VM daemon entrypoint. Bundled into a single .mjs by scripts/bundle-runtime.mjs and
 * launched by orchestrator.provisionConversation as a long-lived Node process.
 *
 * Lifecycle:
 *   1. Parse env (CONVEX_URL, CONVEX_CONVERSATION_ID, CONVEX_AGENT_TOKEN, GEMINI_API_KEY,
 *      TAVILY_API_KEY, AGENT_WORKSPACE_DIR, AGENT_MODEL_ID, AGENT_THINKING_LEVEL).
 *   2. Prepare workspace directory.
 *   3. Open ConvexBridge (WebSocket + HTTP).
 *   4. Heartbeat every 10s (lets the orphan sweeper + UI know we're alive).
 *   5. Subscribe to `ingest.nextQueuedRun` — Convex pushes whenever a run is enqueued.
 *      For each pushed run we serialize processing through a `processing` flag so we never
 *      run two agent loops concurrently against the same conversation.
 *   6. On SIGTERM/SIGINT: stop accepting new runs, await the in-flight one, close cleanly.
 *
 * Crash recovery is NOT in this file — if processRun throws it's caught at the boundary and
 * surfaced via finalizeRun(error). If the whole process dies, the heartbeat goes stale and
 * the orchestrator's reviveDaemonIfDead action restarts us.
 */

interface DaemonEnv {
  convexUrl: string;
  conversationId: string;
  agentToken: string;
  geminiApiKey: string;
  anthropicApiKey?: string;
  openAiApiKey?: string;
  tavilyApiKey?: string;
  workspaceDir: string;
  modelId: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high";
}

function readEnv(): DaemonEnv {
  const get = (k: string): string => {
    const v = process.env[k];
    if (!v || v.trim().length === 0) {
      throw new Error(`Missing required env: ${k}`);
    }
    return v.trim();
  };
  const optional = (k: string, fallback: string): string => {
    const v = process.env[k];
    return v && v.trim().length > 0 ? v.trim() : fallback;
  };
  const thinking = optional("AGENT_THINKING_LEVEL", "off");
  if (!["off", "minimal", "low", "medium", "high"].includes(thinking)) {
    throw new Error(`Invalid AGENT_THINKING_LEVEL: ${thinking}`);
  }
  return {
    convexUrl: get("CONVEX_URL"),
    conversationId: get("CONVEX_CONVERSATION_ID"),
    agentToken: get("CONVEX_AGENT_TOKEN"),
    geminiApiKey: get("GEMINI_API_KEY"),
    anthropicApiKey: optional("ANTHROPIC_API_KEY", "") || undefined,
    openAiApiKey: optional("OPENAI_API_KEY", "") || undefined,
    tavilyApiKey: optional("TAVILY_API_KEY", "") || undefined,
    workspaceDir: optional("AGENT_WORKSPACE_DIR", "/home/daytona/workspace"),
    modelId: optional("AGENT_MODEL_ID", "gemini-2.5-flash"),
    thinkingLevel: thinking as DaemonEnv["thinkingLevel"],
  };
}

async function main(): Promise<void> {
  const env = readEnv();
  console.log(
    `[agent] starting daemon for conversation=${env.conversationId} model=${env.modelId}`,
  );

  const workspace = await Workspace.prepare(env.workspaceDir);
  const bridge = new ConvexBridge({
    convexUrl: env.convexUrl,
    conversationId: env.conversationId,
    agentToken: env.agentToken,
  });

  // Heartbeat loop. Fire-and-forget so we don't block on transient network failures.
  const heartbeatInterval = setInterval(() => {
    void bridge
      .mutation(api.ingest.heartbeat, {
        conversationId: env.conversationId,
        agentToken: env.agentToken,
      })
      .catch((err) => console.error("[agent] heartbeat failed:", err));
  }, 10_000);
  // Send one immediately so the UI flips from "provisioning" to "idle" without waiting 10s.
  await bridge
    .mutation(api.ingest.heartbeat, {
      conversationId: env.conversationId,
      agentToken: env.agentToken,
    })
    .catch((err) => console.error("[agent] initial heartbeat failed:", err));

  let processing = false;
  let pendingRunId: string | null = null;
  let shuttingDown = false;
  let inFlight: Promise<void> = Promise.resolve();

  const tryDispatch = (): void => {
    if (shuttingDown || processing || !pendingRunId) return;
    const runId = pendingRunId;
    pendingRunId = null;
    processing = true;
    inFlight = (async () => {
      try {
        await processRun(
          {
            bridge,
            workspace,
            modelId: env.modelId,
            apiKey: env.geminiApiKey,
            anthropicApiKey: env.anthropicApiKey,
            openAiApiKey: env.openAiApiKey,
            tavilyApiKey: env.tavilyApiKey,
            thinkingLevel: env.thinkingLevel,
          },
          runId,
        );
      } catch (err) {
        // processRun handles its own finalizeRun on agent errors; this catch is for bugs in
        // the loop itself (e.g. a Convex outage during claim). We log loudly and keep the
        // daemon alive so the orchestrator doesn't have to restart us for one bad run.
        console.error("[agent] processRun crashed:", err);
      } finally {
        processing = false;
        // Re-check: a new run may have arrived during processing.
        tryDispatch();
      }
    })();
  };

  const unsubscribe = bridge.subscribe(
    api.ingest.nextQueuedRun,
    {
      conversationId: env.conversationId,
      agentToken: env.agentToken,
    },
    (run) => {
      if (!run) return;
      // Only dispatch genuinely new runIds; subscription updates may fire on unrelated row
      // changes that still match the query. The `processing` guard alone is not enough —
      // we'd queue the same id repeatedly during a long run.
      if (pendingRunId === run._id) return;
      pendingRunId = run._id;
      tryDispatch();
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[agent] received ${signal}, shutting down`);
    clearInterval(heartbeatInterval);
    try {
      unsubscribe();
    } catch (err) {
      console.error("[agent] unsubscribe failed:", err);
    }
    try {
      // Give the in-flight run up to 30s to finalize cleanly. After that, we let the
      // orchestrator notice the missing heartbeat and revive.
      await Promise.race([
        inFlight,
        new Promise((resolve) => setTimeout(resolve, 30_000)),
      ]);
    } finally {
      await bridge.close();
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    console.error("[agent] uncaughtException:", err);
    void shutdown("uncaughtException");
  });
  process.on("unhandledRejection", (reason) => {
    console.error("[agent] unhandledRejection:", reason);
  });
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
