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
 * applications.
 *
 * Loading never throws. An unreadable store means no de-duplication at all,
 * which is precisely the state that produces duplicate applications — strictly
 * worse than reading what survived and reporting the damage. Corrupt lines are
 * counted and surfaced; a torn trailing line is repaired in place so the next
 * append cannot weld it into the middle of the file.
 */
export class JobDatabase {
  public corruptLineCount = 0;
  private processedMap = new Map<string, { hasApplied: boolean; latestSkippedDate?: string }>();
  private currentApplyId = 0;
  private todayRecords: JobRecord[] = [];
  private readonly storePath: string;
  private readonly legacyPath: string;
  private readonly readOnly: boolean;
  /** Where appends go. Differs from storePath only when storePath holds legacy JSON. */
  private writePath: string;

  constructor(storePath: string = config.dbPath, options: JobDatabaseOptions = {}) {
    this.storePath = storePath;
    this.writePath = storePath;
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
  private readLegacyRecords(sourcePath: string = this.legacyPath): StoredRecord[] {
    const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
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

  /** JSONL if the first non-empty line is an object carrying a jobId. */
  private looksLikeJsonl(raw: string): boolean {
    const firstLine = raw.split('\n').find(line => line.trim().length > 0);
    if (!firstLine) return true;
    try {
      const parsed = JSON.parse(firstLine);
      return Boolean(parsed) && typeof parsed === 'object' && 'jobId' in parsed;
    } catch {
      return false;
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = fs.readFileSync(this.storePath, 'utf8');
        if (this.looksLikeJsonl(raw)) {
          this.loadFromJsonl(raw);
          return;
        }

        // The sniff only reads line 1, so a JSONL store whose first line is torn
        // or carries a BOM also fails it. Confirm the legacy shape by actually
        // parsing the file before committing to that path: letting the parse
        // error escape used to throw out of the constructor and brick every
        // subsequent run, before the watchdog or any operator notice could fire.
        let legacyRecords: StoredRecord[];
        try {
          legacyRecords = this.readLegacyRecords(this.storePath);
        } catch {
          console.warn(
            `[DB] ${path.basename(this.storePath)} 首行無法解析且不是舊格式，改以 JSONL 逐行讀取。`,
          );
          this.loadFromJsonl(raw);
          return;
        }

        // The caller handed us the legacy date-bucketed file. Index it so
        // de-duplication still works, but never append JSONL into it.
        this.writePath = this.storePath.endsWith('.json')
          ? `${this.storePath}l`
          : `${this.storePath}.jsonl`;
        console.warn(
          `[DB] ${path.basename(this.storePath)} 是舊格式，僅供讀取；新紀錄將寫入 ${path.basename(this.writePath)}。`,
        );
        for (const record of legacyRecords) {
          this.index(record, record.date);
        }
        if (fs.existsSync(this.writePath)) {
          this.loadFromJsonl(fs.readFileSync(this.writePath, 'utf8'), this.writePath);
        }
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

  private loadFromJsonl(raw: string, sourcePath: string = this.storePath): void {
    const lines = raw.split('\n');
    const today = this.getTodayDateString();
    // Byte offsets, not UTF-16 indices: the store is mostly CJK (3 bytes each)
    // and the repair below hands this straight to fs.truncateSync.
    let lastGoodByteEnd = 0;
    let byteOffset = 0;

    for (let position = 0; position < lines.length; position++) {
      const rawLine = lines[position];
      // Only the final element of a split lacks its terminating newline. Adding
      // 1 unconditionally pushed lastGoodEnd one past the end of a file whose
      // last record was complete but unterminated, which read as "not torn".
      const terminated = position < lines.length - 1;
      byteOffset += Buffer.byteLength(rawLine, 'utf8') + (terminated ? 1 : 0);

      const line = rawLine.trim();
      if (!line) {
        if (terminated) lastGoodByteEnd = byteOffset;
        continue;
      }

      let stored: StoredRecord;
      try {
        stored = JSON.parse(line);
      } catch {
        this.corruptLineCount++;
        console.error(`[DB] 第 ${position + 1} 行無法解析，已略過該筆紀錄。`);
        continue;
      }

      lastGoodByteEnd = byteOffset;
      this.index(stored, stored.date);
      if (stored.date === today) this.todayRecords.push(stored);
    }

    if (this.corruptLineCount > 0) {
      console.error(
        `[DB] 共略過 ${this.corruptLineCount} 行損壞紀錄；去重可能不完整，請檢查 ${path.basename(sourcePath)}。`,
      );
    }

    // A file that ends in a newline has no torn tail — whatever is damaged in it
    // is complete, terminated data that stays on disk for inspection and cannot
    // be welded into by the next append. Truncating it here destroyed recoverable
    // records on a plain read, right after telling the operator to go inspect them.
    if (raw.endsWith('\n') || raw.length === 0) return;

    if (this.readOnly) return;

    // Every record has already been indexed by this point, so a repair that
    // cannot be written (read-only mount, EACCES) must not take the run down
    // with it — the next append is what would suffer, and that will fail loudly.
    try {
      const totalBytes = Buffer.byteLength(raw, 'utf8');
      if (lastGoodByteEnd === totalBytes) {
        // The record itself survived; only its terminating newline was lost. It
        // is real data, so append the newline rather than dropping it.
        fs.appendFileSync(sourcePath, '\n', 'utf8');
        console.warn('[DB] 已補回上次中斷缺少的尾端換行。');
        return;
      }
      // A genuinely half-written record. truncateSync drops exactly those bytes
      // in one metadata operation; a read-modify-write of the whole file would
      // open a window where a crash leaves the store empty, and would silently
      // discard anything a concurrent run appended since this snapshot was read.
      fs.truncateSync(sourcePath, lastGoodByteEnd);
      console.warn('[DB] 已截斷上次中斷留下的殘缺尾行。');
    } catch (error) {
      console.error(
        `[DB] 無法修復殘缺尾行，紀錄已照常載入: ${error instanceof Error ? error.message : String(error)}`,
      );
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

    fs.mkdirSync(path.dirname(this.writePath), { recursive: true });
    fs.appendFileSync(this.writePath, `${JSON.stringify(stored)}\n`, 'utf8');

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
