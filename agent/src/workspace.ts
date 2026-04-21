import path from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Resolves a user-supplied path against a workspace root and refuses to escape it.
 * Every filesystem tool passes user input through this before touching disk.
 */
export class Workspace {
  readonly workDir: string;
  readonly uploadsDir: string;

  constructor(public readonly root: string) {
    this.workDir = path.join(root, "work");
    this.uploadsDir = path.join(root, "uploads");
  }

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
    this.assertInside(resolved, this.root, candidate, "workspace");
    return resolved;
  }

  /**
   * Writable paths are constrained to workspace/work.
   * Relative paths like `main.py` are treated as `work/main.py`.
   */
  resolveWritable(candidate: string): string {
    const input = (candidate?.trim() || ".").replace(/\\/g, "/");
    const normalized = input.replace(/^\.\/+/, "");
    const scoped =
      path.isAbsolute(input) || normalized.startsWith("work/")
        ? input
        : `work/${normalized}`;
    const resolved = path.isAbsolute(scoped)
      ? path.resolve(scoped)
      : path.resolve(this.root, scoped);
    if (resolved === this.uploadsDir || resolved.startsWith(this.uploadsDir + path.sep)) {
      throw new Error(
        "Refusing to write inside uploads/. Copy files to work/ first, then edit the copy.",
      );
    }
    this.assertInside(resolved, this.workDir, candidate, "work/");
    return resolved;
  }

  relative(absolutePath: string): string {
    return path.relative(this.root, absolutePath).split(path.sep).join("/");
  }

  private assertInside(
    target: string,
    base: string,
    originalInput: string,
    label: string,
  ): void {
    if (target === base || target.startsWith(base + path.sep)) {
      return;
    }
    throw new Error(`Path escapes ${label}: ${originalInput}`);
  }
}
