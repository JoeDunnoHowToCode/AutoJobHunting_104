import * as fs from 'fs';
import * as path from 'path';

/**
 * Append-only record of failures that must NOT reach applyRecord.json.
 *
 * A transient failure means the job was never really evaluated, so it stays a
 * valid candidate for the next run. It still needs to be visible somewhere —
 * otherwise a quota outage looks identical to a quiet day.
 */

export type TransientStage = 'jd' | 'llm' | 'apply' | 'search';

export interface TransientLogEntry {
  jobId: string;
  title: string;
  stage: TransientStage;
  kind: string;
  reason: string;
}

const DEFAULT_LOG_PATH = path.resolve(__dirname, '..', 'logs', 'transient.jsonl');

export function appendTransientLog(entry: TransientLogEntry, logPath: string = DEFAULT_LOG_PATH): void {
  // Diagnostics must never take the run down with them.
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch (error) {
    console.warn(`[transient-log] 寫入失敗，已略過: ${error instanceof Error ? error.message : String(error)}`);
  }
}
