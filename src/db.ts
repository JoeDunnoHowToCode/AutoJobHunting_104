import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

export interface JobRecord {
  applyId?: number;
  jobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  score: number;
  reason: string;
  status: 'applied' | 'skipped' | 'failed';
  coverLetter?: string;
  processedAt: string;
}

/** One JSONL line: the record plus the date bucket it belongs to. */
interface StoredRecord extends JobRecord {
  date: string;
}

export interface JobDatabaseOptions {
  /**
   * Allows a run to use historical records for de-duplication without ever
   * creating or modifying the store. Used by the pre-submit dry-run.
   */
  readOnly?: boolean;
}

/**
 * Append-only record store.
 *
 * Every write is a single `appendFileSync` of one line. The previous design
 * re-serialised the whole file on every record, which meant a crash mid-run
 * lost the entire run's history — and losing history is what causes duplicate
 * applications. Reads tolerate a truncated final line for the same reason.
 */
export class JobDatabase {
  public corruptLineCount = 0;
  private processedMap = new Map<string, { hasApplied: boolean; latestSkippedDate?: string }>();
  private currentApplyId = 0;
  private todayRecords: JobRecord[] = [];
  private readonly storePath: string;
  private readonly legacyPath: string;
  private readonly readOnly: boolean;

  constructor(storePath: string = config.dbPath, options: JobDatabaseOptions = {}) {
    this.storePath = storePath;
    this.legacyPath = storePath.replace(/\.jsonl$/, '.json');
    this.readOnly = options.readOnly ?? false;
    this.load();
  }

  private getTodayDateString(): string {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().split('T')[0];
  }

  /**
   * A `failed` record must not enter the index at all. It carries neither
   * hasApplied nor latestSkippedDate, so an indexed entry would make
   * hasBeenProcessed() fall through to its unconditional `return true` and
   * exclude the job forever, with no expiry. That cost 56 jobs — 31 of them to
   * nothing worse than a Gemini 429.
   */
  private index(record: JobRecord, dateStr: string): void {
    if (record.applyId && record.applyId > this.currentApplyId) {
      this.currentApplyId = record.applyId;
    }
    if (record.status === 'failed') return;

    const entry = this.processedMap.get(record.jobId) || { hasApplied: false };
    if (record.status === 'applied') {
      entry.hasApplied = true;
    } else if (record.status === 'skipped' && (!entry.latestSkippedDate || dateStr > entry.latestSkippedDate)) {
      entry.latestSkippedDate = dateStr;
    }
    this.processedMap.set(record.jobId, entry);
  }

  /** Flattens the legacy date-bucketed object into ordered StoredRecords. */
  private readLegacyRecords(): StoredRecord[] {
    const parsed = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8'));
    const flattened: StoredRecord[] = [];

    for (const date of Object.keys(parsed).sort()) {
      const day = parsed[date];
      if (!day || typeof day !== 'object') continue;
      for (const status of ['applied', 'skipped', 'failed'] as const) {
        for (const record of day[status] ?? []) {
          flattened.push({ ...record, location: record.location || 'Unknown', date });
        }
      }
    }
    return flattened;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        this.loadFromJsonl();
        return;
      }

      if (fs.existsSync(this.legacyPath)) {
        const legacy = this.readLegacyRecords();
        for (const record of legacy) this.index(record, record.date);
        // A dry-run must leave the filesystem untouched, so it keeps the legacy
        // file as its source and simply skips the migration.
        if (!this.readOnly) {
          fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
          fs.writeFileSync(
            this.storePath,
            legacy.map(record => JSON.stringify(record)).join('\n') + (legacy.length > 0 ? '\n' : ''),
            'utf8',
          );
          console.log(`[DB] 已從 ${path.basename(this.legacyPath)} 遷移 ${legacy.length} 筆紀錄至 JSONL。`);
        }
      }
    } catch (error) {
      console.error('Failed to load database. Halting to prevent data loss or silent error:', error);
      throw error;
    }
  }

  private loadFromJsonl(): void {
    const lines = fs.readFileSync(this.storePath, 'utf8').split('\n');
    const today = this.getTodayDateString();

    for (let position = 0; position < lines.length; position++) {
      const line = lines[position].trim();
      if (!line) continue;

      let stored: StoredRecord;
      try {
        stored = JSON.parse(line);
      } catch (error) {
        // Only the final line can legitimately be half-written (SIGKILL during
        // append). A corrupt line anywhere else means real damage.
        if (position === lines.length - 1) {
          console.warn('[DB] 最後一行不完整，已略過（可能是上次執行被強制中斷）。');
          continue;
        }
        throw error;
      }

      this.index(stored, stored.date);
      if (stored.date === today) this.todayRecords.push(stored);
    }
  }

  public getNextApplyId(): number {
    if (this.readOnly) {
      throw new Error('JobDatabase is read-only; dry-run must not allocate apply IDs.');
    }
    this.currentApplyId++;
    return this.currentApplyId;
  }

  public hasBeenProcessed(jobId: string): boolean {
    const entry = this.processedMap.get(jobId);
    if (!entry) return false;
    if (entry.hasApplied) return true;
    if (entry.latestSkippedDate) {
      const recordDate = new Date(entry.latestSkippedDate);
      const daysSince = Math.floor((Date.now() - recordDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince >= 14) return false;
    }
    return true;
  }

  public addRecord(record: JobRecord): void {
    if (this.readOnly) {
      throw new Error('JobDatabase is read-only; dry-run records must not be persisted.');
    }
    const today = this.getTodayDateString();
    const stored: StoredRecord = { ...record, date: today };

    fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
    fs.appendFileSync(this.storePath, `${JSON.stringify(stored)}\n`, 'utf8');

    this.index(record, today);
    this.todayRecords.push(record);
  }

  public getAppliedJobsCount(): number {
    return this.currentApplyId;
  }

  public getTodayRecords(): { applied: JobRecord[]; skipped: JobRecord[]; failed: JobRecord[] } {
    return {
      applied: this.todayRecords.filter(record => record.status === 'applied'),
      skipped: this.todayRecords.filter(record => record.status === 'skipped'),
      failed: this.todayRecords.filter(record => record.status === 'failed'),
    };
  }
}
