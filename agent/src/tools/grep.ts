import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { Workspace } from "../workspace.js";
import { escapeRegExp, globToRegExp, truncateText } from "./util.js";

const GrepParams = Type.Object({
  pattern: Type.String({ description: "Regex pattern (or literal when literal=true)." }),
  path: Type.Optional(Type.String({ description: "Root path to search. Default: workspace root." })),
  glob: Type.Optional(Type.String({ description: "Glob filter to limit files, e.g. `**/*.ts`." })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive match." })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as a literal string, not regex." })),
  limit: Type.Optional(Type.Number({ description: "Maximum matches to return. Default 100." })),
});

type GrepInput = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  limit?: number;
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".venv", "__pycache__"]);
const FILE_SIZE_LIMIT = 1024 * 1024; // skip files > 1MB to avoid binary/giant logs

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function step(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await step(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  await step(root);
  return out;
}

export function createGrepTool(workspace: Workspace) {
  return {
    name: "grep",
    label: "grep",
    description:
      "Recursively search file contents for a regex or literal pattern, returning `path:line: content` matches.",
    parameters: GrepParams,
    async execute(_id: string, params: GrepInput) {
      const rootAbs = workspace.resolve(params.path || ".");
      const rootStats = await stat(rootAbs);
      const files = rootStats.isDirectory() ? await walkFiles(rootAbs) : [rootAbs];

      const globRe = params.glob ? globToRegExp(params.glob) : null;
      const limit = Math.max(1, Number.isFinite(params.limit) ? (params.limit as number) : 100);
      const regex = new RegExp(
        params.literal ? escapeRegExp(params.pattern) : params.pattern,
        params.ignoreCase ? "i" : "",
      );

      const matches: string[] = [];

      outer: for (const file of files) {
        const rel = path.relative(rootAbs, file).split(path.sep).join("/");
        if (globRe && !globRe.test(rel)) continue;

        const fileStats = await stat(file);
        if (fileStats.size > FILE_SIZE_LIMIT) continue;

        let text: string;
        try {
          text = await readFile(file, "utf8");
        } catch {
          continue; // binary or unreadable
        }

        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (regex.test(lines[i] ?? "")) {
            matches.push(`${rel}:${i + 1}: ${lines[i]}`);
            if (matches.length >= limit) break outer;
          }
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: truncateText(matches.join("\n") || "No matches found."),
          },
        ],
        details: {
          pattern: params.pattern,
          root: workspace.relative(rootAbs),
          count: matches.length,
          limit,
        },
      };
    },
  };
}
