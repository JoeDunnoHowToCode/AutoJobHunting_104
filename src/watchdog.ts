/**
 * Fires once when the pipeline stops making progress.
 *
 * This is the inner half of a two-layer guard. The outer half lives in the VM
 * startup script (`timeout 7200 npm start || true; shutdown -h now`) and covers
 * the case where Node itself wedges. This half exists so the run can still
 * report *why* it gave up before it exits.
 */

export interface ProgressWatchdogOptions {
  stallMs: number;
  onStall: () => void;
  /** How often to compare the clock against the last tick. */
  checkIntervalMs?: number;
}

export class ProgressWatchdog {
  private readonly stallMs: number;
  private readonly onStall: () => void;
  private readonly checkIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastProgressAt = 0;
  private hasStalled = false;

  constructor(options: ProgressWatchdogOptions) {
    this.stallMs = options.stallMs;
    this.onStall = options.onStall;
    this.checkIntervalMs = options.checkIntervalMs ?? 60_000;
  }

  public start(): void {
    if (this.timer) return;
    this.lastProgressAt = Date.now();
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
    // Never hold the event loop open on the watchdog's account.
    this.timer.unref?.();
  }

  /** Call on every observable unit of progress. */
  public tick(): void {
    this.lastProgressAt = Date.now();
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  public get stalled(): boolean {
    return this.hasStalled;
  }

  private check(): void {
    if (this.hasStalled) return;
    if (Date.now() - this.lastProgressAt < this.stallMs) return;
    this.hasStalled = true;
    this.stop();
    this.onStall();
  }
}
