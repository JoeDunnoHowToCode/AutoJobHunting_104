/**
 * Stops a run once the LLM provider is clearly out of quota.
 *
 * retry.ts already backs off individual 429s, which is right for a momentary
 * spike. It is useless against an exhausted daily quota: every remaining job
 * burns ~36s of backoff and then fails. 97 of the 113 recorded LLM failures
 * were 429s, concentrated in three days — the shape of a quota wall, not of
 * transient contention.
 *
 * Tripping is therefore permanent for the run. A daily allowance does not come
 * back within the same run, so `recordSuccess()` cannot un-trip it.
 */

export interface RateLimitCircuitOptions {
  threshold?: number;
}

const DEFAULT_THRESHOLD = 5;
const RATE_LIMIT_PATTERN = /429|too many requests|rate limit|quota|resource exhausted/i;

function isRateLimit(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (Number(candidate.status ?? candidate.code) === 429) return true;
  return RATE_LIMIT_PATTERN.test(String(candidate.message ?? ''));
}

export class RateLimitCircuit {
  private readonly threshold: number;
  private consecutive = 0;
  private tripped = false;

  constructor(options: RateLimitCircuitOptions = {}) {
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  public recordFailure(error: unknown): void {
    // A non-rate-limit failure is unrelated noise: it neither counts toward the
    // threshold nor clears progress toward it.
    if (!isRateLimit(error)) return;
    this.consecutive++;
    if (this.consecutive >= this.threshold) this.tripped = true;
  }

  public recordSuccess(): void {
    if (this.tripped) return;
    this.consecutive = 0;
  }

  public get shouldStop(): boolean {
    return this.tripped;
  }

  public get consecutiveCount(): number {
    return this.consecutive;
  }
}
