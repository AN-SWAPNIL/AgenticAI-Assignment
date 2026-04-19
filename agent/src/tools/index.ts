import type { Workspace } from "../workspace.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadTool } from "./read.js";
import { createWebfetchTool } from "./webfetch.js";
import { createWebsearchTool } from "./websearch.js";
import { createWriteTool } from "./write.js";

export function createTools(workspace: Workspace) {
  return [
    createBashTool(workspace),
    createReadTool(workspace),
    createWriteTool(workspace),
    createEditTool(workspace),
    createGrepTool(workspace),
    createGlobTool(workspace),
    createWebfetchTool(),
    createWebsearchTool(),
  ];
}
