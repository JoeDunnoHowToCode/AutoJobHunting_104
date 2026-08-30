import * as fs from 'fs';
import * as path from 'path';

/**
 * Append-only record of failures that must NOT reach applyRecord.json, plus the
 * retry budget derived from them.
 *
 * A transient failure means the job was never really evaluated, so it stays a
 * valid candidate for the next run. Without a ceiling that promise turns into a
 * trap: a job that fails the same way every time costs a JD fetch, a paid LLM
 * call, an apply slot and a screenshot on every single run, forever. Reading
 * the log back is what bounds it.
 */

export type TransientStage = 'jd' | 'llm' | 'apply' | 'search';

export interface TransientLogEntry {
  jobId: string;
  title: string;
  stage: TransientStage;
  kind: string;
  reason: string;
}

export interface TransientLogOptions {
  /** Attempts allowed before a job is treated as settled rather than retried. */
  maxAttempts?: number;
}

const DEFAULT_LOG_PATH = path.resolve(__dirname, '..', 'logs', 'transient.jsonl');
const DEFAULT_MAX_ATTEMPTS = 3;

/** Marks every prior failure for a job as resolved without rewriting history. */
interface ClearMarker {
  jobId: string;
  cleared: true;
}

export class TransientLog {
  private readonly logPath: string;
  private readonly maxAttempts: number;
  private readonly counts = new Map<string, number>();

  constructor(logPath: string = DEFAULT_LOG_PATH, options: TransientLogOptions = {}) {
    this.logPath = logPath;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.load();
  }

  private load(): void {
    // Diagnostics must never take the run down with them, so a missing or
    // damaged log degrades to "no history" rather than throwing.
    try {
      if (!fs.existsSync(this.logPath) || !fs.statSync(this.logPath).isFile()) return;
      const raw = fs.readFileSync(this.logPath, 'utf8');

      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let parsed: (TransientLogEntry & Partial<ClearMarker>) | undefined;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        if (!parsed?.jobId) continue;

        if (parsed.cleared) this.counts.delete(parsed.jobId);
        else this.counts.set(parsed.jobId, (this.counts.get(parsed.jobId) ?? 0) + 1);
      }

      this.repairTornTail(raw);
    } catch (error) {
      console.warn(`[transient-log] 讀取失敗，本輪視為無歷史紀錄: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Without this the next append welds onto a half-written last line, the count
   * stops advancing and the budget never fires again — reopening the very trap
   * it was added to close. Same rule as the record store: a record that lost
   * only its newline is kept, a genuinely half-written one is dropped.
   */
  private repairTornTail(raw: string): void {
    if (!raw || raw.endsWith('\n')) return;
    const lines = raw.split('\n');
    const tail = lines[lines.length - 1];

    let tailIsComplete = false;
    try {
      tailIsComplete = Boolean(JSON.parse(tail));
    } catch {
      tailIsComplete = false;
    }

    if (tailIsComplete) {
      fs.appendFileSync(this.logPath, '\n', 'utf8');
      return;
    }
    fs.truncateSync(this.logPath, Buffer.byteLength(raw, 'utf8') - Buffer.byteLength(tail, 'utf8'));
  }

  private appendLine(payload: object): void {
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      fs.appendFileSync(this.logPath, `${JSON.stringify(payload)}\n`, 'utf8');
    } catch (error) {
      console.warn(`[transient-log] 寫入失敗，已略過: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public append(entry: TransientLogEntry): void {
    this.appendLine({ ts: new Date().toISOString(), ...entry });
    this.counts.set(entry.jobId, (this.counts.get(entry.jobId) ?? 0) + 1);
  }

  /** Call after a job finally succeeds, so its history stops counting against it. */
  public clear(jobId: string): void {
    if (!this.counts.has(jobId)) return;
    this.appendLine({ ts: new Date().toISOString(), jobId, cleared: true });
    this.counts.delete(jobId);
  }

  public failureCountFor(jobId: string): number {
    return this.counts.get(jobId) ?? 0;
  }

  public hasExhaustedBudget(jobId: string): boolean {
    return this.failureCountFor(jobId) >= this.maxAttempts;
  }
}

/** Kept for callers that only write. Prefer the class when a budget matters. */
export function appendTransientLog(entry: TransientLogEntry, logPath: string = DEFAULT_LOG_PATH): void {
  new TransientLog(logPath).append(entry);
}
