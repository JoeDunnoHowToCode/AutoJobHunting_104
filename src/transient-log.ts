/** Interface skeleton only — no write logic yet, so the spec fails on assertions. */

export type TransientStage = 'jd' | 'llm' | 'apply' | 'search';

export interface TransientLogEntry {
  jobId: string;
  title: string;
  stage: TransientStage;
  kind: string;
  reason: string;
}

export function appendTransientLog(_entry: TransientLogEntry, _logPath?: string): void {
  // not implemented
}
