"use node";

import { Daytona, type Sandbox } from "@daytona/sdk";
import { safeDeleteSandbox } from "./daytonaUtils";
import { Buffer } from "node:buffer";
import process from "node:process";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action } from "./_generated/server";
import {
  AGENT_HOST_BUNDLE,
  AGENT_PACKAGE_JSON,
  RUNTIME_VERSION,
} from "./runtime/agentHostBundle.generated";

/**
 * Daytona-side orchestration. Three actions:
 *   - provisionConversation: create sandbox, upload bundle, install deps, launch daemon.
 *   - reviveDaemonIfDead:    if heartbeat is stale, re-launch the daemon in the existing
 *                            session. Idempotent — safe to call repeatedly.
 *   - deleteConversationSandbox: tear down the VM when a conversation is removed.
 *
 * The daemon itself runs in a persistent Daytona session and holds its own Convex client;
 * once launched, the orchestrator never talks to it directly. All ongoing communication is
 * via Convex (heartbeat in, runs subscription out).
 */

const DAYTONA_TARGET = "eu";
const AUTO_STOP_MINUTES = 30;
const BOOTSTRAP_TIMEOUT_SECONDS = 600;
const STALE_HEARTBEAT_MS = 30_000;
const RUNTIME_DIR = "/home/daytona/agent";
const WORKSPACE_DIR = "/home/daytona/workspace";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing Convex deployment env var: ${name}`);
  }
  return value.trim();
}

function createDaytona(): Daytona {
  return new Daytona({
    apiKey: requiredEnv("DAYTONA_API_KEY"),
    target: DAYTONA_TARGET,
  });
}

function shellQuote(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 60);
}

async function ensureSession(sandbox: Sandbox, sessionId: string): Promise<void> {
  try {
    await sandbox.process.getSession(sessionId);
  } catch {
    await sandbox.process.createSession(sessionId);
  }
}

async function execOrThrow(
  sandbox: Sandbox,
  command: string,
  cwd: string,
  timeoutSeconds: number,
): Promise<void> {
  const response = await sandbox.process.executeCommand(
    command,
    cwd,
    undefined,
    timeoutSeconds,
  );
  if (response.exitCode !== 0) {
    throw new Error(
      `Sandbox command failed (exit ${response.exitCode}): ${command}\n${response.result ?? ""}`,
    );
  }
}

async function execInSessionOrThrow(
  sandbox: Sandbox,
  sessionId: string,
  command: string,
  timeoutSeconds: number,
): Promise<void> {
  const response = await sandbox.process.executeSessionCommand(
    sessionId,
    {
      command,
      runAsync: false,
      suppressInputEcho: true,
    },
    timeoutSeconds,
  );
  if (response.exitCode !== 0) {
    const output =
      response.output ??
      [response.stdout, response.stderr].filter(Boolean).join("\n");
    throw new Error(
      `Failed to launch daemon (exit ${response.exitCode}): ${output ?? ""}`.trim(),
    );
  }
}

/**
 * Upload the bundle, optionally install deps, and launch the daemon as a detached background process.
 *
 * When DAYTONA_SNAPSHOT is set, deps are pre-installed in the snapshot image — we skip npm install
 * to cut cold-start time from ~30s to ~5s. The bundle (agentHost.mjs) is always uploaded fresh
 * because it changes with every code release.
 *
 * Idempotent — safe to call again on revive: writeFile overwrites, kill-by-pidfile cleans up prior daemon.
 */
async function bootstrapDaemon(
  sandbox: Sandbox,
  sessionId: string,
  env: {
    convexUrl: string;
    conversationId: string;
    agentToken: string;
    openAiApiKey: string;
    tavilyApiKey?: string;
    modelId?: string;
    thinkingLevel?: string;
  },
): Promise<void> {
  await sandbox.fs.createFolder(RUNTIME_DIR, "755").catch(() => undefined);
  await sandbox.fs.createFolder(WORKSPACE_DIR, "755").catch(() => undefined);
  await sandbox.fs.createFolder(`${WORKSPACE_DIR}/uploads`, "755").catch(() => undefined);

  const hasSnapshot = !!process.env.DAYTONA_SNAPSHOT?.trim();

  if (!hasSnapshot) {
    // No snapshot: install deps from scratch (cold path).
    await sandbox.fs.uploadFile(
      Buffer.from(AGENT_PACKAGE_JSON, "utf8"),
      `${RUNTIME_DIR}/package.json`,
    );
    await execOrThrow(
      sandbox,
      "npm install --omit=dev --silent --no-fund --no-audit",
      RUNTIME_DIR,
      BOOTSTRAP_TIMEOUT_SECONDS,
    );
  }

  // Always upload the latest bundle (changes on every code release).
  await sandbox.fs.uploadFile(
    Buffer.from(AGENT_HOST_BUNDLE, "utf8"),
    `${RUNTIME_DIR}/agentHost.mjs`,
  );

  const defaultModel = process.env.AGENT_MODEL_ID?.trim() || "gpt-4.1";
  const modelId = env.modelId?.trim() || defaultModel;

  const envExports = [
    `export CONVEX_URL=${shellQuote(env.convexUrl)}`,
    `export CONVEX_CONVERSATION_ID=${shellQuote(env.conversationId)}`,
    `export CONVEX_AGENT_TOKEN=${shellQuote(env.agentToken)}`,
    `export OPENAI_API_KEY=${shellQuote(env.openAiApiKey)}`,
    ...(env.tavilyApiKey ? [`export TAVILY_API_KEY=${shellQuote(env.tavilyApiKey)}`] : []),
    ...(process.env.ANTHROPIC_API_KEY ? [`export ANTHROPIC_API_KEY=${shellQuote(process.env.ANTHROPIC_API_KEY)}`] : []),
    `export AGENT_WORKSPACE_DIR=${shellQuote(WORKSPACE_DIR)}`,
    `export AGENT_MODEL_ID=${shellQuote(modelId)}`,
    `export AGENT_THINKING_LEVEL=${shellQuote(env.thinkingLevel || "off")}`,
  ].join("\n");

  const launchScript = [
    `cd ${shellQuote(RUNTIME_DIR)}`,
    `if [ -f host.pid ]; then kill "$(cat host.pid)" 2>/dev/null || true; sleep 1; fi`,
    envExports,
    `nohup node agentHost.mjs > host.log 2>&1 &`,
    `echo $! > host.pid`,
  ].join("\n");

  await execInSessionOrThrow(sandbox, sessionId, launchScript, 60);

  await execOrThrow(
    sandbox,
    [
      "sleep 2",
      "if [ -f host.pid ] && kill -0 \"$(cat host.pid)\" 2>/dev/null; then exit 0; fi",
      "echo '[orchestrator] daemon failed to stay alive after launch'",
      "if [ -f host.log ]; then cat host.log; fi",
      "exit 1",
    ].join(" && "),
    RUNTIME_DIR,
    30,
  );
}

// ─── actions ────────────────────────────────────────────────────────────────

export const provisionConversation = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<{ sandboxId: string }> => {
    const conversation: Doc<"conversations"> | null = await ctx.runQuery(
      api.conversations.get,
      { conversationId },
    );
    if (!conversation) throw new Error("Conversation not found");

    const convexUrl = requiredEnv("CONVEX_CLOUD_URL");
    const openAiApiKey = requiredEnv("OPENAI_API_KEY");
    const tavilyApiKey = process.env.TAVILY_API_KEY?.trim() || undefined;

    try {
      const daytona = createDaytona();
      const snapshotName = process.env.DAYTONA_SNAPSHOT?.trim();

      const baseLabels = { app: "agentic-assignment", conversationId: String(conversationId) };
      const fallbackParams = { language: "typescript" as const, autoStopInterval: AUTO_STOP_MINUTES, labels: baseLabels };

      // Try snapshot first (faster cold start); fall back to language runtime if snapshot not found.
      let sandbox: Awaited<ReturnType<typeof daytona.create>>;
      if (snapshotName) {
        try {
          sandbox = await daytona.create({ snapshot: snapshotName, autoStopInterval: AUTO_STOP_MINUTES, labels: baseLabels });
        } catch (snapshotErr) {
          const msg = snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr);
          console.warn(`[orchestrator] snapshot "${snapshotName}" failed (${msg}); falling back to language runtime`);
          sandbox = await daytona.create(fallbackParams);
        }
      } else {
        sandbox = await daytona.create(fallbackParams);
      }

      const sessionId = sanitizeSessionId(`daemon-${String(conversationId)}-${Date.now()}`);
      await ensureSession(sandbox, sessionId);

      await bootstrapDaemon(sandbox, sessionId, {
        convexUrl,
        conversationId: String(conversationId),
        agentToken: conversation.agentToken,
        openAiApiKey,
        tavilyApiKey,
        modelId: conversation.modelId,
        thinkingLevel: conversation.thinkingLevel,
      });

      await ctx.runMutation(internal.conversations.patchForOrchestrator, {
        conversationId,
        patch: {
          status: "idle",
          sandboxId: sandbox.id,
          sessionId,
          workspaceDir: WORKSPACE_DIR,
          runtimeDir: RUNTIME_DIR,
          runtimeVersion: RUNTIME_VERSION,
          lastError: undefined,
        },
      });

      return { sandboxId: sandbox.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.conversations.patchForOrchestrator, {
        conversationId,
        patch: { status: "error", lastError: message },
      });
      throw err;
    }
  },
});

export const reviveDaemonIfDead = action({
  args: { conversationId: v.id("conversations") },
  handler: async (
    ctx,
    { conversationId },
  ): Promise<{ revived: boolean; reason?: string }> => {
    const conversation: Doc<"conversations"> | null = await ctx.runQuery(
      api.conversations.get,
      { conversationId },
    );
    if (!conversation) return { revived: false, reason: "not-found" };
    if (!conversation.sandboxId || !conversation.sessionId) {
      // Provision failed originally (e.g. snapshot not found) — re-provision now.
      await ctx.runAction(api.orchestrator.provisionConversation, { conversationId });
      return { revived: true, reason: "re-provisioned" };
    }

    // Allow revive from any state: explicit user action should always attempt re-launch.
    // Exception: only skip when daemon is fresh+idle AND already on current runtime.
    const fresh = Date.now() - (conversation.lastHeartbeatAt ?? 0) < STALE_HEARTBEAT_MS;
    const runtimeMatches = conversation.runtimeVersion === RUNTIME_VERSION;
    if (fresh && conversation.status === "idle" && runtimeMatches) {
      return { revived: false, reason: "heartbeat-fresh" };
    }

    const convexUrl = requiredEnv("CONVEX_CLOUD_URL");
    const openAiApiKey = requiredEnv("OPENAI_API_KEY");
    const tavilyApiKey = process.env.TAVILY_API_KEY?.trim() || undefined;

    try {
      const daytona = createDaytona();
      const sandbox = await daytona.get(conversation.sandboxId);
      try {
        await sandbox.start();
      } catch {
        // already running — ignore
      }
      await ensureSession(sandbox, conversation.sessionId);
      await bootstrapDaemon(sandbox, conversation.sessionId, {
        convexUrl,
        conversationId: String(conversationId),
        agentToken: conversation.agentToken,
        openAiApiKey,
        tavilyApiKey,
        modelId: conversation.modelId,
        thinkingLevel: conversation.thinkingLevel,
      });

      await ctx.runMutation(internal.conversations.patchForOrchestrator, {
        conversationId,
        patch: { status: "idle", lastError: undefined },
      });
      return { revived: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.conversations.patchForOrchestrator, {
        conversationId,
        patch: { status: "error", lastError: message },
      });
      throw err;
    }
  },
});

export const deleteConversationSandbox = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<void> => {
    const conversation: Doc<"conversations"> | null = await ctx.runQuery(
      api.conversations.get,
      { conversationId },
    );
    // get() returns null for soft-deleted rows — read directly via internal query if needed.
    // For now: if no conversation visible, attempt sandbox delete by id from raw table read.
    const sandboxId =
      conversation?.sandboxId ??
      (await ctx
        .runQuery(internal.conversations.rawForOrchestrator, { conversationId })
        .then((r: { sandboxId?: string } | null) => r?.sandboxId));

    if (!sandboxId) return;
    try {
      const daytona = createDaytona();
      const sandbox = await daytona.get(sandboxId);
      await safeDeleteSandbox(daytona, sandbox);
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404) return; // already gone
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] delete sandbox ${sandboxId} failed:`, message);
    }
  },
});
