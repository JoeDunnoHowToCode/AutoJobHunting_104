import { isRateLimitError, isTransientSignal } from '../failure-policy';

/**
 * The one rule where this layer legitimately differs from `classifyFailure`.
 *
 * A schema-validation failure is transient at the *run* level — the job stays a
 * candidate and the model may produce valid output next time — but retrying it
 * in-process just sends the same prompt three times and burns quota. Everything
 * else about transience is shared, so the provider's commonest real error (a 429
 * quota body with no `status` field) is recognised identically on both sides.
 */
const NOT_WORTH_IMMEDIATE_RETRY = /schema validation failed/i;

function isRetryable(error: unknown): boolean {
  const message = String((error as { message?: unknown } | null)?.message ?? '');
  if (NOT_WORTH_IMMEDIATE_RETRY.test(message)) return false;
  return isTransientSignal(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** Retries only transient provider failures; validation and credential errors fail immediately. */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  context: string,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxAttempts) throw error;

      const isRateLimit = isRateLimitError(error);
      const baseDelay = isRateLimit ? 12000 * attempt : 1000 * 2 ** (attempt - 1);
      const jitteredDelay = Math.round(baseDelay * (0.85 + Math.random() * 0.3));
      console.warn(`${context} ${isRateLimit ? '速率受限 (429)' : '暫時性失敗'}；${jitteredDelay}ms 後進行第 ${attempt + 1}/${maxAttempts} 次嘗試。`);
      await sleep(jitteredDelay);
    }
  }
  throw lastError;
}
