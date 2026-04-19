import { readFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { Workspace } from "../workspace.js";
import { truncateText } from "./util.js";

const ReadParams = Type.Object({
  path: Type.String({ description: "Path to the file, relative to the workspace root." }),
  offset: Type.Optional(
    Type.Number({ description: "1-indexed line number to start reading from. Default 1." }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of lines to return (max 2000). Default 500." }),
  ),
});

type ReadInput = { path: string; offset?: number; limit?: number };

export function createReadTool(workspace: Workspace) {
  return {
    name: "read",
    label: "read",
    description:
      "Read a text file from the workspace, optionally slicing by line range. Output is line-numbered.",
    parameters: ReadParams,
    async execute(_id: string, params: ReadInput) {
      const resolved = workspace.resolve(params.path);
      const raw = await readFile(resolved, "utf8");
      const lines = raw.split(/\r?\n/);
      const offset = Math.max(1, Number.isFinite(params.offset) ? (params.offset as number) : 1);
      const limit = Math.min(
        Math.max(1, Number.isFinite(params.limit) ? (params.limit as number) : 500),
        2000,
      );
      const slice = lines.slice(offset - 1, offset - 1 + limit);

      const numbered = slice
        .map((line, idx) => `${String(offset + idx).padStart(4, " ")}  ${line}`)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: truncateText(numbered) }],
        details: {
          path: workspace.relative(resolved),
          offset,
          limit,
          totalLines: lines.length,
        },
      };
    },
  };
}
