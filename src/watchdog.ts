/** Interface skeleton only — no timer logic yet. */

export interface ProgressWatchdogOptions {
  stallMs: number;
  onStall: () => void;
  checkIntervalMs?: number;
}

export class ProgressWatchdog {
  constructor(_options: ProgressWatchdogOptions) {}
  public start(): void {}
  public tick(): void {}
  public stop(): void {}
  public get stalled(): boolean {
    return false;
  }
}
