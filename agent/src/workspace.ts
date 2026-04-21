import path from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Resolves a user-supplied path against a workspace root and refuses to escape it.
 * Every filesystem tool passes user input through this before touching disk.
 */
export class Workspace {
  constructor(public readonly root: string) {}

  static async prepare(root: string): Promise<Workspace> {
    const resolved = path.resolve(root);
    await mkdir(resolved, { recursive: true });
    await mkdir(path.join(resolved, "work"), { recursive: true });
    await mkdir(path.join(resolved, "uploads"), { recursive: true });
    return new Workspace(resolved);
  }

  resolve(candidate: string): string {
    const input = candidate?.trim() || ".";
    const resolved = path.resolve(this.root, input);
    // Ensure the resolved path is strictly inside the root. Checking startsWith(root + sep)
    // handles the edge case where root === resolved (OK) and prevents `/home/daytona/workspace-foo`
    // passing when root is `/home/daytona/workspace`.
    if (resolved !== this.root && !resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes workspace: ${candidate}`);
    }
    return resolved;
  }

  relative(absolutePath: string): string {
    return path.relative(this.root, absolutePath).split(path.sep).join("/");
  }
}
