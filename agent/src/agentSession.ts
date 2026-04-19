import { Agent } from "@mariozechner/pi-agent-core";
import { getModel, getModels } from "@mariozechner/pi-ai";
import type { Workspace } from "./workspace.js";
import { createTools } from "./tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";

export interface AgentSessionOptions {
  workspace: Workspace;
  modelId: string;
  apiKey: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
}

/**
 * Construct a fresh pi-agent-core Agent bound to the workspace. One session per run;
 * message history is primed from Convex before `agent.prompt()` is called.
 */
export function createAgentSession(opts: AgentSessionOptions) {
  const model = resolveModel(opts.modelId);
  const tools = createTools(opts.workspace);

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(opts.workspace.root),
      model,
      thinkingLevel: opts.thinkingLevel ?? "off",
      tools,
      messages: [],
    },
    getApiKey: async (provider: string) => {
      if (provider !== "google") return undefined;
      return opts.apiKey;
    },
  });

  return { agent, model };
}

function resolveModel(id: string) {
  // pi-ai's getModel accepts a string-typed model id union; we cast because the daemon takes
  // the id from an env var and we want to fail at runtime (with a clear message) rather than
  // at compile time when a future Gemini id isn't yet in the union.
  const requested = getModel("google", id as Parameters<typeof getModel>[1]);
  if (requested) return requested;
  const available = getModels("google");
  if (Array.isArray(available) && available.length > 0) {
    return available[0];
  }
  throw new Error("No Google Gemini model available in @mariozechner/pi-ai");
}

