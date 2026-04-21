import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import type { Workspace } from "./workspace.js";
import { createTools } from "./tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";

export interface AgentSessionOptions {
  workspace: Workspace;
  modelId: string;
  openAiApiKey: string;
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
  const model = resolveModel(opts.modelId);
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
      thinkingLevel: resolveThinkingLevel(opts.thinkingLevel) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: tools as any,
      messages: [],
    },
    getApiKey: async (_reqProvider: string) => opts.openAiApiKey,
  });

  return { agent, model };
}

/**
 * For OpenAI reasoning models: "off"/"none" → "minimal" since they require a thinking level.
 * Standard GPT models (gpt-4o, gpt-4.1): return "off" and pi-ai ignores the budget.
 */
function resolveThinkingLevel(level: string | undefined): string {
  const requested = level ?? "off";
  // Reasoning models reject "off" — map to "minimal".
  if (requested === "off" || requested === "none") return "minimal";
  return requested;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveModel(id: string): any {
  const openAiModel = getModel("openai", id as Parameters<typeof getModel>[1]);
  if (openAiModel) return openAiModel;
  throw new Error(`OpenAI model "${id}" not found. Available: gpt-4.1, gpt-4o, gpt-5-nano, gpt-5-mini`);
}
