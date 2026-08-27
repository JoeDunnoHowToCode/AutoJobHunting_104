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

  const status = statusOf(candidate);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
    return 'transient';
  }

  const code = String(candidate.code ?? candidate.cause?.code ?? '').toUpperCase();
  if (TRANSIENT_NETWORK_CODES.has(code)) return 'transient';

  const message = String(candidate.message ?? '');
  if (TRANSIENT_MESSAGE_PATTERN.test(message)) return 'transient';
  // Provider SDKs often bury the real status inside a JSON string body.
  if (/"code"\s*:\s*(429|5\d{2})/.test(message)) return 'transient';

  // Nothing identified this as settled. Defaulting to transient costs one extra
  // evaluation next round; defaulting to permanent costs the job forever.
  return 'transient';
}
