/**
 * Batches text_delta chunks into 150ms windows (or end-of-sentence) so the daemon doesn't
 * issue one Convex mutation per token. Flushes via a user-provided async sink.
 *
 * Flushing at sentence boundaries keeps the UI feeling live while still amortizing network
 * overhead. If the agent pauses mid-sentence for >150ms (common during tool calls), we flush
 * whatever's accumulated so the reader isn't left staring at a half-rendered clause.
 */
export class DeltaBuffer {
  private buffer = "";
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private readonly sink: (chunk: string) => Promise<void>,
    private readonly intervalMs: number = 150,
  ) {}

  push(chunk: string): void {
    if (!chunk) return;
    this.buffer += chunk;
    if (/[.!?\n]$/.test(chunk)) {
      // Sentence boundary — flush eagerly for responsiveness.
      this.scheduleFlush(0);
    } else if (this.timer === null) {
      this.scheduleFlush(this.intervalMs);
    }
  }

  private scheduleFlush(delay: number): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushNow();
    }, delay);
  }

  private flushNow(): void {
    if (this.buffer.length === 0) return;
    const payload = this.buffer;
    this.buffer = "";
    // Chain onto the previous flush so writes reach Convex in order even when scheduled
    // back-to-back. If one flush fails we surface it on the returned promise of flush().
    this.flushing = this.flushing.then(() => this.sink(payload));
  }

  /** Flush any pending chunk and await completion of all in-flight flushes. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushNow();
    await this.flushing;
  }
}
