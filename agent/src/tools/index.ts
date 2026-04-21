import type { Workspace } from "../workspace.js";
import { Type, type TSchema } from "@sinclair/typebox";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadTool } from "./read.js";
import { createShareFileTool } from "./shareFile.js";
import { createWebfetchTool } from "./webfetch.js";
import { createWebsearchTool } from "./websearch.js";
import { createWriteTool } from "./write.js";

export interface ToolRuntimeOptions {
  workspace: Workspace;
  tavilyApiKey?: string;
  onQueueFileExport?: (args: { path: string; displayName?: string }) => Promise<{
    sessionFileId: string;
  }>;
  /** Called with each bash stdout/stderr chunk for live streaming to Convex. */
  onBashChunk?: (toolCallId: string, chunk: string) => void;
}

const DEFAULT_TOOL_TIMEOUT_SECONDS = 5;

const ToolTimeoutParam = Type.Object({
  timeoutSeconds: Type.Optional(
    Type.Number({
      description:
        "Per-call timeout in seconds. Default 5. Increase for long operations, decrease for fast fail.",
    }),
  ),
});

type RuntimeTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: unknown) => Promise<unknown>;
};

function resolveTimeoutSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_TOOL_TIMEOUT_SECONDS;
}

function mergeSchemaProperties(base: unknown, extra: unknown): unknown {
  // Flatten both Type.Object schemas into a single Type.Object so the resulting JSON Schema
  // has `type: "object"` at the top level with no `allOf`/`anyOf` — required by Gemini.
  const b = base as { properties?: Record<string, TSchema>; required?: string[] };
  const e = extra as { properties?: Record<string, TSchema>; required?: string[] };
  return Type.Object({
    ...b.properties,
    ...e.properties,
  });
}

function withToolTimeout(tool: RuntimeTool): RuntimeTool {
  return {
    ...tool,
    parameters: mergeSchemaProperties(tool.parameters, ToolTimeoutParam),
    async execute(id: string, params: unknown) {
      const timeoutSeconds = resolveTimeoutSeconds(
        (params as { timeoutSeconds?: unknown } | undefined)?.timeoutSeconds,
      );
      let timer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${tool.name} timed out after ${timeoutSeconds}s. Retry with a larger timeoutSeconds if needed.`,
            ),
          );
        }, timeoutSeconds * 1000);
      });
      try {
        return await Promise.race([tool.execute(id, params), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

export function createTools(opts: ToolRuntimeOptions) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Array<{
    name: string;
    label: string;
    description: string;
    parameters: unknown;
    execute: (id: string, params: any) => Promise<any>;
  }> = [
    createBashTool(opts.workspace, { onChunk: opts.onBashChunk }),
    createReadTool(opts.workspace),
    createWriteTool(opts.workspace),
    createEditTool(opts.workspace),
    createGrepTool(opts.workspace),
    createGlobTool(opts.workspace),
    createWebfetchTool(),
    createWebsearchTool({ tavilyApiKey: opts.tavilyApiKey }),
  ];

  if (opts.onQueueFileExport) {
    tools.push(
      createShareFileTool(opts.workspace, {
        queueExport: opts.onQueueFileExport,
      }),
    );
  }

  return tools.map((tool) => withToolTimeout(tool));
}
