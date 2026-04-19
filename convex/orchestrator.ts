"use node";

import { Daytona, type Sandbox } from "@daytona/sdk";
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
 * Upload the bundle, install deps, and launch the daemon as a detached background process.
 * Idempotent — safe to call again on revive: writeFile overwrites, npm ci is fast on cache,
 * launch command kills any prior pidfile-tracked process before starting fresh.
 */
async function bootstrapDaemon(
  sandbox: Sandbox,
  sessionId: string,
  env: {
    convexUrl: string;
    conversationId: string;
    agentToken: string;
    geminiApiKey: string;
    tavilyApiKey?: string;
  },
): Promise<void> {
  await sandbox.fs.createFolder(RUNTIME_DIR, "755").catch(() => undefined);
  await sandbox.fs.createFolder(WORKSPACE_DIR, "755").catch(() => undefined);

  await sandbox.fs.uploadFile(
    Buffer.from(AGENT_PACKAGE_JSON, "utf8"),
    `${RUNTIME_DIR}/package.json`,
  );
  await sandbox.fs.uploadFile(
    Buffer.from(AGENT_HOST_BUNDLE, "utf8"),
    `${RUNTIME_DIR}/agentHost.mjs`,
  );

  await execOrThrow(
    sandbox,
    "npm install --omit=dev --silent --no-fund --no-audit",
    RUNTIME_DIR,
    BOOTSTRAP_TIMEOUT_SECONDS,
  );

  const envExports = [
    `export CONVEX_URL=${shellQuote(env.convexUrl)}`,
    `export CONVEX_CONVERSATION_ID=${shellQuote(env.conversationId)}`,
    `export CONVEX_AGENT_TOKEN=${shellQuote(env.agentToken)}`,
    `export GEMINI_API_KEY=${shellQuote(env.geminiApiKey)}`,
    ...(env.tavilyApiKey
      ? [`export TAVILY_API_KEY=${shellQuote(env.tavilyApiKey)}`]
      : []),
    `export AGENT_WORKSPACE_DIR=${shellQuote(WORKSPACE_DIR)}`,
    `export AGENT_MODEL_ID=${shellQuote("gemini-2.5-flash")}`,
  ].join("\n");

  const launchScript = [
    `cd ${shellQuote(RUNTIME_DIR)}`,
    // Kill prior daemon (ignore failure — may not exist yet).
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
    const geminiApiKey = requiredEnv("GEMINI_API_KEY");
    const tavilyApiKey = process.env.TAVILY_API_KEY?.trim() || undefined;

    try {
      const daytona = createDaytona();
      const sandbox = await daytona.create({
        language: "typescript",
        autoStopInterval: AUTO_STOP_MINUTES,
        labels: {
          app: "agentic-assignment",
          conversationId: String(conversationId),
        },
      });

      const sessionId = sanitizeSessionId(
        `daemon-${String(conversationId)}-${Date.now()}`,
      );
      await ensureSession(sandbox, sessionId);

      await bootstrapDaemon(sandbox, sessionId, {
        convexUrl,
        conversationId: String(conversationId),
        agentToken: conversation.agentToken,
        geminiApiKey,
        tavilyApiKey,
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
      return { revived: false, reason: "not-provisioned" };
    }

    const fresh = Date.now() - (conversation.lastHeartbeatAt ?? 0) < STALE_HEARTBEAT_MS;
    if (fresh) {
      return { revived: false, reason: "heartbeat-fresh" };
    }

    const convexUrl = requiredEnv("CONVEX_CLOUD_URL");
    const geminiApiKey = requiredEnv("GEMINI_API_KEY");
    const tavilyApiKey = process.env.TAVILY_API_KEY?.trim() || undefined;

    try {
      const daytona = createDaytona();
      const sandbox = await daytona.get(conversation.sandboxId);
      // Sandbox may have auto-stopped after 30min idle; start it back up.
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
        geminiApiKey,
        tavilyApiKey,
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
      await daytona.delete(sandbox);
    } catch (err) {
      // 404 is fine — sandbox may have been auto-cleaned. Anything else: log and let the
      // sweeper retry on the next pass.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[orchestrator] delete sandbox ${sandboxId} failed:`, message);
    }
  },
});
