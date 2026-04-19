import { ConvexClient, ConvexHttpClient } from "convex/browser";
import type { FunctionReference, FunctionReturnType, FunctionArgs } from "convex/server";

/**
 * Authenticated wrapper around Convex clients. Holds the agentToken binding and exposes
 * typed mutation/query/subscribe helpers.
 *
 * Two clients because:
 *   - ConvexClient (WebSocket) powers subscribe() — Convex pushes query results as they change.
 *     Used for the daemon's `nextQueuedRun` subscription (the reverse channel).
 *   - ConvexHttpClient makes one-shot mutation calls — cheaper than a WS round-trip for
 *     fire-and-forget telemetry writes, and resilient to WS reconnect blips.
 *
 * The mutation/query helpers infer arg & return types directly from the FunctionReference
 * passed in (`TFn["_args"]`/`FunctionReturnType<TFn>`), so callers get full type safety
 * against the API stubs in convexApi.ts.
 */

export interface ConvexBridgeOptions {
  convexUrl: string;
  conversationId: string;
  agentToken: string;
}

export class ConvexBridge {
  private readonly ws: ConvexClient;
  private readonly http: ConvexHttpClient;

  constructor(private readonly opts: ConvexBridgeOptions) {
    this.ws = new ConvexClient(opts.convexUrl);
    this.http = new ConvexHttpClient(opts.convexUrl);
  }

  get conversationId(): string {
    return this.opts.conversationId;
  }

  get agentToken(): string {
    return this.opts.agentToken;
  }

  /**
   * Subscribe to a Convex query. Returns an unsubscribe function.
   */
  subscribe<TFn extends FunctionReference<"query", "public">>(
    fn: TFn,
    args: FunctionArgs<TFn>,
    onUpdate: (result: FunctionReturnType<TFn>) => void,
  ): () => void {
    return this.ws.onUpdate(fn, args, (value: unknown) =>
      onUpdate(value as FunctionReturnType<TFn>),
    );
  }

  async mutation<TFn extends FunctionReference<"mutation", "public">>(
    fn: TFn,
    args: FunctionArgs<TFn>,
  ): Promise<FunctionReturnType<TFn>> {
    return (await this.http.mutation(fn, args)) as FunctionReturnType<TFn>;
  }

  async query<TFn extends FunctionReference<"query", "public">>(
    fn: TFn,
    args: FunctionArgs<TFn>,
  ): Promise<FunctionReturnType<TFn>> {
    return (await this.http.query(fn, args)) as FunctionReturnType<TFn>;
  }

  async close(): Promise<void> {
    await this.ws.close();
  }
}
