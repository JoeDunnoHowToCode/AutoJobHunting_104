function isRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown; cause?: { code?: unknown } };
  const status = Number(candidate.status ?? candidate.code);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;

  const code = String(candidate.code ?? candidate.cause?.code ?? '').toUpperCase();
  if (['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) return true;

  const message = String(candidate.message ?? '');
  return /network|fetch failed|timeout|temporarily unavailable|resource exhausted|rate limit/i.test(message);
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

      const baseDelay = 1000 * 2 ** (attempt - 1);
      const jitteredDelay = Math.round(baseDelay * (0.75 + Math.random() * 0.5));
      console.warn(`${context} 暫時性失敗；${jitteredDelay}ms 後進行第 ${attempt + 1}/${maxAttempts} 次嘗試。`);
      await sleep(jitteredDelay);
    }
  }
  throw lastError;
}
