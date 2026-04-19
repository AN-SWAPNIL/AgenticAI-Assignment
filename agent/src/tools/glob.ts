import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { Workspace } from "../workspace.js";
import { globToRegExp, truncateText } from "./util.js";

const GlobParams = Type.Object({
  pattern: Type.String({ description: "Glob pattern, e.g. `**/*.py` or `src/**/*.test.ts`." }),
  path: Type.Optional(Type.String({ description: "Root path. Default: workspace root." })),
  limit: Type.Optional(Type.Number({ description: "Maximum results. Default 200." })),
});

type GlobInput = { pattern: string; path?: string; limit?: number };

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".venv", "__pycache__"]);

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

export function createGlobTool(workspace: Workspace) {
  return {
    name: "glob",
    label: "glob",
    description:
      "Find file paths matching a glob pattern. Supports `*`, `**`, and `?`. Returns paths relative to the search root.",
    parameters: GlobParams,
    async execute(_id: string, params: GlobInput) {
      const rootAbs = workspace.resolve(params.path || ".");
      const rootStats = await stat(rootAbs);
      const allFiles = rootStats.isDirectory() ? await walkFiles(rootAbs) : [rootAbs];

      const re = globToRegExp(params.pattern);
      const limit = Math.max(1, Number.isFinite(params.limit) ? (params.limit as number) : 200);

      const matches = allFiles
        .map((p) => path.relative(rootAbs, p).split(path.sep).join("/"))
        .filter((rel) => re.test(rel))
        .slice(0, limit);

      return {
        content: [
          {
            type: "text" as const,
            text: truncateText(matches.join("\n") || "No paths matched."),
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
