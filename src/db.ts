import * as fs from 'fs';
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

interface DailyRecords {
  applied: JobRecord[];
  skipped: JobRecord[];
  failed: JobRecord[];
}

interface ApplyRecordData {
  [date: string]: DailyRecords;
}

export interface JobDatabaseOptions {
  /**
   * Allows a run to use historical records for de-duplication without ever
   * creating or modifying applyRecord.json. Used by the pre-submit dry-run.
   */
  readOnly?: boolean;
}

export class JobDatabase {
  private data: ApplyRecordData = {};
  private currentApplyId: number = 0;
  private processedMap = new Map<string, { hasApplied: boolean; latestSkippedDate?: string }>();
  private readonly dbPath: string;
  private readonly readOnly: boolean;

  constructor(dbPath: string = config.dbPath, options: JobDatabaseOptions = {}) {
    this.dbPath = dbPath;
    this.readOnly = options.readOnly ?? false;
    this.load();
  }

  private rebuildIndex(): void {
    this.processedMap.clear();
    for (const date in this.data) {
      for (const status of ['applied', 'skipped', 'failed'] as const) {
        for (const record of this.data[date][status]) {
          this.updateProcessedIndex(record, date);
        }
      }
    }
  }

  private updateProcessedIndex(record: JobRecord, dateStr: string): void {
    const entry = this.processedMap.get(record.jobId) || { hasApplied: false };
    if (record.status === 'applied') {
      entry.hasApplied = true;
    } else if (record.status === 'skipped' && (!entry.latestSkippedDate || dateStr > entry.latestSkippedDate)) {
      entry.latestSkippedDate = dateStr;
    }
    this.processedMap.set(record.jobId, entry);
  }

  private getTodayDateString(): string {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localTime = new Date(now.getTime() - tzOffset);
    return localTime.toISOString().split('T')[0];
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        const rawData = fs.readFileSync(this.dbPath, 'utf8');
        const parsed = JSON.parse(rawData);
        
        // Check if it's the old flat format or the new date-based format
        const keys = Object.keys(parsed);
        let maxApplyId = 0;

        if (keys.length > 0 && parsed[keys[0]].hasOwnProperty('jobId')) {
           // It's the old flat format, migrate it
           for (const key of keys) {
             const record = parsed[key] as JobRecord;
             const dateStr = record.processedAt ? record.processedAt.split('T')[0] : '2026-01-01';
             if (!this.data[dateStr]) {
               this.data[dateStr] = { applied: [], skipped: [], failed: [] };
             }
             if (!record.location) record.location = 'Unknown';
             if (record.status === 'applied') {
               maxApplyId++;
               record.applyId = maxApplyId;
             }
             this.data[dateStr][record.status].push(record);
           }
           if (!this.readOnly) this.save();
        } else {
           this.data = parsed;
           // Find max applyId
           for (const date in this.data) {
             for (const r of this.data[date].applied) {
               if (r.applyId && r.applyId > maxApplyId) {
                 maxApplyId = r.applyId;
               }
             }
           }
        }
        this.currentApplyId = maxApplyId;
      } else {
        this.data = {};
        if (!this.readOnly) this.save();
      }
      this.rebuildIndex();
    } catch (error) {
      console.error('Failed to load database. Halting to prevent data loss or silent error:', error);
      throw error;
    }
  }

  private save(): void {
    try {
      const tmp = this.dbPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.dbPath);
    } catch (error) {
      console.error('Failed to save database. Halting to prevent silent write error:', error);
      throw error;
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
      const now = new Date();
      const daysSince = Math.floor((now.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince >= 14) return false;
    }
    return true;
  }

  public addRecord(record: JobRecord): void {
    if (this.readOnly) {
      throw new Error('JobDatabase is read-only; dry-run records must not be persisted.');
    }
    const today = this.getTodayDateString();
    if (!this.data[today]) {
      this.data[today] = { applied: [], skipped: [], failed: [] };
    }
    
    // Remove if it exists in failed from today
    this.data[today].failed = this.data[today].failed.filter(r => r.jobId !== record.jobId);
    
    this.data[today][record.status].push(record);
    this.updateProcessedIndex(record, today);
    this.save();
  }

  public getAppliedJobsCount(): number {
    return this.currentApplyId;
  }

  public getTodayRecords(): DailyRecords {
    const today = this.getTodayDateString();
    return this.data[today] || { applied: [], skipped: [], failed: [] };
  }
}
