import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, getModels } from "@mariozechner/pi-ai";
import type { Workspace } from "./workspace.js";
import { createTools } from "./tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";

export interface AgentSessionOptions {
  workspace: Workspace;
  modelId: string;
  apiKey: string;
  anthropicApiKey?: string;
  openAiApiKey?: string;
  tavilyApiKey?: string;
  onQueueFileExport?: (args: { path: string; displayName?: string }) => Promise<{
    sessionFileId: string;
  }>;
  /** Live bash output streaming callback (toolCallId, chunk) → void. */
  onBashChunk?: (toolCallId: string, chunk: string) => void;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
}

/**
 * Construct a fresh pi-agent-core Agent bound to the workspace. One session per run;
 * message history is primed from Convex before `agent.prompt()` is called.
 */
export function createAgentSession(opts: AgentSessionOptions) {
  const { model, provider } = resolveModel(opts.modelId);
  const tools = createTools({
    workspace: opts.workspace,
    tavilyApiKey: opts.tavilyApiKey,
    onQueueFileExport: opts.onQueueFileExport,
    onBashChunk: opts.onBashChunk,
  });

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt({ workspaceDir: opts.workspace.root, modelId: opts.modelId }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinkingLevel: resolveThinkingLevel(opts.thinkingLevel, provider) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      messages: [],
    },
    getApiKey: async (reqProvider: string) => {
      if (reqProvider === "google") return opts.apiKey;
      if (reqProvider === "anthropic") return opts.anthropicApiKey;
      if (reqProvider === "openai") return opts.openAiApiKey;
      return undefined;
    },
  });

  return { agent, model, provider };
}

/**
 * Normalize the stored thinkingLevel preference to what each provider actually accepts.
 *
 * - Google / Anthropic: "off" | "low" | "medium" | "high"
 * - OpenAI non-reasoning (gpt-4o, gpt-4.1): no thinking parameter — return "off" and let
 *   the pi-ai layer ignore it (it only passes thinkingBudget for reasoning models).
 * - OpenAI reasoning (gpt-5-nano, gpt-5-mini, o-series): "minimal" | "low" | "medium" | "high"
 *   — "off" and "none" are rejected; map to "minimal".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveThinkingLevel(level: string | undefined, provider: string): string {
  const requested = level ?? "off";
  if (provider === "openai") {
    // OpenAI reasoning models: "off"/"none" → "minimal"
    if (requested === "off" || requested === "none") return "minimal";
    return requested;
  }
  return requested;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveModel(id: string): { model: any; provider: string } {
  // Try Google (Gemini) first
  const googleModel = getModel("google", id as Parameters<typeof getModel>[1]);
  if (googleModel) return { model: googleModel, provider: "google" };

  // Try Anthropic (Claude)
  const anthropicModel = getModel("anthropic", id as Parameters<typeof getModel>[1]);
  if (anthropicModel) return { model: anthropicModel, provider: "anthropic" };

  // Try OpenAI (GPT)
  const openAiModel = getModel("openai", id as Parameters<typeof getModel>[1]);
  if (openAiModel) return { model: openAiModel, provider: "openai" };

  // Fallback: first available Google model
  const available = getModels("google");
  if (Array.isArray(available) && available.length > 0) {
    console.warn(`[agent] Model "${id}" not found; falling back to ${String(available[0])}`);
    return { model: available[0], provider: "google" };
  }

  throw new Error(`No model available for id: "${id}"`);
}
