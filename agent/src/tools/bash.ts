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

export function createBashTool(workspace: Workspace) {
  return {
    name: "bash",
    label: "bash",
    description:
      "Execute a shell command inside the sandbox. Use this for any task that fits shell idioms (listing, piping, compiling, running scripts).",
    parameters: BashParams,
    async execute(_id: string, params: BashInput) {
      const command = params.command?.trim();
      if (!command) throw new Error("command cannot be empty");

      const timeoutMs = Math.min(
        Math.max(Number.isFinite(params.timeoutSeconds) ? (params.timeoutSeconds as number) : 60, 1),
        120,
      ) * 1000;

      return await new Promise<{ content: Array<{ type: "text"; text: string }>; details: unknown }>(
        (resolve, reject) => {
          const child = spawn("bash", ["-c", command], {
            cwd: workspace.root,
            env: process.env,
          });

          let stdout = "";
          let stderr = "";
          const deadline = setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`Command timed out after ${timeoutMs / 1000}s: ${command}`));
          }, timeoutMs);

          child.stdout.on("data", (d) => {
            stdout += d.toString();
          });
          child.stderr.on("data", (d) => {
            stderr += d.toString();
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
