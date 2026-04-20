import type { Workspace } from "../workspace.js";
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

  return tools;
}
