/** Interface skeleton only — no counting logic yet. */

export interface RateLimitCircuitOptions {
  threshold?: number;
}

export class RateLimitCircuit {
  constructor(_options: RateLimitCircuitOptions = {}) {}
  public recordFailure(_error: unknown): void {}
  public recordSuccess(): void {}
  public get shouldStop(): boolean {
    return false;
  }
  public get consecutiveCount(): number {
    return 0;
  }
}
