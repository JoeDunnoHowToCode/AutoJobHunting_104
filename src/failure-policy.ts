/**
 * Splits a job-level failure into "this job is settled" and "we simply did not
 * get to evaluate it this round".
 *
 * Only `permanent` failures may reach the deduplication database. A `transient`
 * failure means the job is still a valid candidate, so it must leave no trace
 * that `hasBeenProcessed()` can see — otherwise a quota outage silently
 * excludes hundreds of jobs forever.
 */
export type FailureKind = 'permanent' | 'transient';

/** Raised when a submission was clicked but its outcome could not be confirmed. */
export class UnverifiedSubmissionError extends Error {
  public readonly buttonText?: string;

  constructor(message: string, buttonText?: string) {
    super(message);
    this.name = 'UnverifiedSubmissionError';
    this.buttonText = buttonText;
  }
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
]);

const TRANSIENT_MESSAGE_PATTERN =
  /net::ERR_|network|fetch failed|timeout|timed out|socket hang up|temporarily unavailable|resource exhausted|rate limit|quota|schema validation failed|too many requests/i;

function statusOf(candidate: { status?: unknown; code?: unknown }): number {
  return Number(candidate.status ?? candidate.code);
}

/** Platform form-error codes that mean the job itself is settled. */
const SETTLED_FORM_CODES = new Set(['ALREADY_APPLIED', 'JOB_UNAVAILABLE']);

/**
 * Positive evidence that a failure is transient.
 *
 * Unlike `classifyFailure` this has no default: an unrecognised error returns
 * false. That is what lets callers which must NOT retry unknown failures — the
 * provider backoff in ai/retry.ts, where a bad API key has to fail immediately —
 * share these recognisers instead of maintaining a narrower private copy that
 * drifts. The copy in retry.ts missed `quota` and the JSON-body probe, so the
 * provider's own commonest error got zero retries.
 */
export function isTransientSignal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; status?: unknown; cause?: { code?: unknown } };

  const status = statusOf(candidate);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;

  const code = String(candidate.code ?? candidate.cause?.code ?? '').toUpperCase();
  if (TRANSIENT_NETWORK_CODES.has(code)) return true;

  const message = String(candidate.message ?? '');
  if (TRANSIENT_MESSAGE_PATTERN.test(message)) return true;
  // Provider SDKs often bury the real status inside a JSON string body.
  return /"code"\s*:\s*(429|5\d{2})/.test(message);
}

const RATE_LIMIT_PATTERN = /429|too many requests|rate limit|quota|resource exhausted/i;

/** Shared 429 recogniser, so backoff choice and circuit tripping never disagree. */
export function isRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (statusOf(candidate) === 429) return true;
  return RATE_LIMIT_PATTERN.test(String(candidate.message ?? ''));
}

export function classifyFailure(error: unknown): FailureKind {
  if (!error || typeof error !== 'object') return 'transient';

  const candidate = error as {
    name?: unknown;
    status?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown };
  };

  // Recognised by shape, not by `instanceof`, so this stays a platform-agnostic
  // policy module: a second platform can raise its own ApplicationFormError
  // without this file importing it.
  if (candidate.name === 'ApplicationFormError') {
    return SETTLED_FORM_CODES.has(String(candidate.code)) ? 'permanent' : 'transient';
  }

  // A clicked submission with an unreadable outcome is never settled. Retrying
  // is safe because openApplicationForm checks the applied-state button before
  // it clicks anything.
  if (candidate.name === 'UnverifiedSubmissionError') return 'transient';

  if (isTransientSignal(error)) return 'transient';

  // Nothing identified this as settled. Defaulting to transient costs one extra
  // evaluation next round; defaulting to permanent costs the job forever.
  return 'transient';
}
