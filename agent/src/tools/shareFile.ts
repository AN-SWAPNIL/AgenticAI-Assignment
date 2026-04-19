import { stat } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { Workspace } from "../workspace.js";

const ShareFileParams = Type.Object({
  path: Type.String({
    description:
      "Path to a file inside the workspace to publish for user download.",
  }),
  displayName: Type.Optional(
    Type.String({
      description: "Optional friendly filename shown in chat/download history.",
    }),
  ),
});

type ShareFileInput = { path: string; displayName?: string };

export interface ShareFileHook {
  queueExport: (args: { path: string; displayName?: string }) => Promise<{ sessionFileId: string }>;
}

export function createShareFileTool(workspace: Workspace, hook: ShareFileHook) {
  return {
    name: "share_file",
    label: "share_file",
    description:
      "Queue a workspace file for user download. Use this after generating reports, code archives, or artifacts the user should save locally.",
    parameters: ShareFileParams,
    async execute(_id: string, params: ShareFileInput) {
      const candidate = params.path.trim();
      if (!candidate) {
        throw new Error("path cannot be empty");
      }

      const resolved = workspace.resolve(candidate);
      const details = await stat(resolved);
      if (!details.isFile()) {
        throw new Error("path must point to a regular file");
      }

      const relativePath = workspace.relative(resolved);
      const queued = await hook.queueExport({
        path: relativePath,
        displayName: params.displayName?.trim() || undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Queued ${relativePath} for download. ` +
              `Tracking id: ${queued.sessionFileId}.`,
          },
        ],
        details: {
          path: relativePath,
          sessionFileId: queued.sessionFileId,
          sizeBytes: details.size,
        },
      };
    },
  };
}
