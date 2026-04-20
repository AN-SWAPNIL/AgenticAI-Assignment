"use node";

import type { Daytona, Sandbox } from "@daytona/sdk";

/**
 * Stops then deletes a sandbox.
 *
 * Common failure: 403 "Access denied" — this means the API key lacks the
 * `delete:sandboxes` scope. Fix: go to Daytona Dashboard → API Keys →
 * regenerate key with all scopes (create, read, delete).
 */
export async function safeDeleteSandbox(daytona: Daytona, sandbox: Sandbox): Promise<void> {
  // Stop first — required before deletion (403 is returned for running sandboxes too).
  try {
    await daytona.stop(sandbox);
  } catch {
    // Already stopped, or stuck in a transitional state — proceed anyway.
  }

  try {
    await daytona.delete(sandbox);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404) return; // already gone — success
    if (status === 403) {
      console.error(
        `[daytona] delete sandbox ${sandbox.id} failed with 403 Access Denied.`,
        "This is almost always caused by an API key that lacks the 'delete:sandboxes' scope.",
        "Fix: Daytona Dashboard → API Keys → create a new key with full scopes (create/read/delete).",
      );
      return; // don't rethrow — log and skip so sweeper/orchestrator can continue
    }
    throw err;
  }
}
