import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { Workspace } from "../workspace.js";

const WriteParams = Type.Object({
  path: Type.String({ description: "File path relative to the workspace root." }),
  content: Type.String({ description: "Full content to write." }),
  createOnly: Type.Optional(
    Type.Boolean({ description: "If true, fail when the file already exists. Default false." }),
  ),
});

type WriteInput = { path: string; content: string; createOnly?: boolean };

export function createWriteTool(workspace: Workspace) {
  return {
    name: "write",
    label: "write",
    description:
      "Create or overwrite a file with the given full content. Parent directories are created as needed. Prefer `edit` for small modifications to existing files.",
    parameters: WriteParams,
    async execute(_id: string, params: WriteInput) {
      const resolved = workspace.resolve(params.path);
      if (params.createOnly) {
        const exists = await access(resolved).then(
          () => true,
          () => false,
        );
        if (exists) {
          throw new Error(`File already exists: ${params.path} (createOnly=true)`);
        }
      }
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, params.content, "utf8");
      return {
        content: [
          { type: "text" as const, text: `Wrote ${workspace.relative(resolved)}` },
        ],
        details: {
          path: workspace.relative(resolved),
          bytes: Buffer.byteLength(params.content, "utf8"),
        },
      };
    },
  };
}
