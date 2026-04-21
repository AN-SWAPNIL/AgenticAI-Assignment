import { readFile, writeFile } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { Workspace } from "../workspace.js";

const EditParams = Type.Object({
  path: Type.String({
    description:
      "File path to edit. Relative paths are resolved under workspace/work/.",
  }),
  oldText: Type.String({ description: "Exact text block to replace. Must match verbatim." }),
  newText: Type.String({ description: "Replacement text." }),
  replaceAll: Type.Optional(
    Type.Boolean({ description: "If true, replace every occurrence. Default false (requires unique match)." }),
  ),
});

type EditInput = { path: string; oldText: string; newText: string; replaceAll?: boolean };

export function createEditTool(workspace: Workspace) {
  return {
    name: "edit",
    label: "edit",
    description:
      "Surgical exact-match replacement within an existing file in workspace/work/. For uniqueness safety, `oldText` must appear exactly once unless `replaceAll: true`.",
    parameters: EditParams,
    async execute(_id: string, params: EditInput) {
      const resolved = workspace.resolveWritable(params.path);
      const before = await readFile(resolved, "utf8");

      if (!before.includes(params.oldText)) {
        throw new Error("oldText not found in target file");
      }

      const occurrences = before.split(params.oldText).length - 1;
      if (!params.replaceAll && occurrences > 1) {
        throw new Error(
          `oldText matches ${occurrences} times — add more context to make it unique, or set replaceAll=true.`,
        );
      }

      const after = params.replaceAll
        ? before.split(params.oldText).join(params.newText)
        : before.replace(params.oldText, params.newText);

      await writeFile(resolved, after, "utf8");
      return {
        content: [
          {
            type: "text" as const,
            text: `Updated ${workspace.relative(resolved)} (${occurrences} replacement${occurrences === 1 ? "" : "s"})`,
          },
        ],
        details: {
          path: workspace.relative(resolved),
          occurrences,
          replaceAll: !!params.replaceAll,
        },
      };
    },
  };
}
