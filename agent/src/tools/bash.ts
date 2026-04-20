import { spawn } from "node:child_process";
import { Type } from "@sinclair/typebox";
import type { Workspace } from "../workspace.js";
import { truncateText } from "./util.js";

const BashParams = Type.Object({
  command: Type.String({ description: "Shell command to execute." }),
  description: Type.Optional(
    Type.String({ description: "Short description of what this command does, for logging." }),
  ),
  timeoutSeconds: Type.Optional(
    Type.Number({ description: "Timeout in seconds (max 120). Default 60." }),
  ),
});

type BashInput = {
  command: string;
  description?: string;
  timeoutSeconds?: number;
};

export interface BashToolOptions {
  /** Called with each stdout/stderr chunk as it arrives. Used for live output streaming. */
  onChunk?: (toolCallId: string, chunk: string) => void;
}

export function createBashTool(workspace: Workspace, options: BashToolOptions = {}) {
  return {
    name: "bash",
    label: "bash",
    description:
      "Execute a shell command inside the sandbox. Use this for any task that fits shell idioms (listing, piping, compiling, running scripts).",
    parameters: BashParams,
    async execute(id: string, params: BashInput) {
      const command = params.command?.trim();
      if (!command) throw new Error("command cannot be empty");

      const timeoutMs =
        Math.min(
          Math.max(
            Number.isFinite(params.timeoutSeconds) ? (params.timeoutSeconds as number) : 60,
            1,
          ),
          120,
        ) * 1000;

      return await new Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>(
        (resolve, reject) => {
          // Prepend standard Debian system paths — Daytona's executor may strip PATH,
          // causing /usr/bin/apt-get, /usr/bin/gcc, etc. to be "not found".
          const SYSTEM_PATH =
            "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
          const childEnv = {
            ...process.env,
            PATH: SYSTEM_PATH + (process.env.PATH ? `:${process.env.PATH}` : ""),
          };
          const child = spawn("bash", ["-c", command], {
            cwd: workspace.root,
            env: childEnv,
          });

          let stdout = "";
          let stderr = "";
          const deadline = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Command timed out after ${timeoutMs / 1000}s: ${command}`));
          }, timeoutMs);

          child.stdout.on("data", (d: Buffer) => {
            const chunk = d.toString();
            stdout += chunk;
            options.onChunk?.(id, chunk);
          });

          child.stderr.on("data", (d: Buffer) => {
            const chunk = d.toString();
            stderr += chunk;
            // Stream stderr too (useful for build progress, etc.)
            options.onChunk?.(id, chunk);
          });

          child.on("close", (code) => {
            clearTimeout(deadline);
            const sections: string[] = [];
            if (stdout) sections.push(`stdout:\n${stdout}`);
            if (stderr) sections.push(`stderr:\n${stderr}`);
            sections.push(`exit code: ${code}`);
            const text = truncateText(sections.join("\n\n") || "(no output)");
            if (code === 0) {
              resolve({
                content: [{ type: "text", text }],
                details: { command, exitCode: code, ok: true },
              });
            } else {
              reject(new Error(text));
            }
          });

          child.on("error", (err) => {
            clearTimeout(deadline);
            reject(err);
          });
        },
      );
    },
  };
}
