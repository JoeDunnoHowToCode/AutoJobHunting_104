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

export class JobDatabase {
  private data: ApplyRecordData = {};
  private currentApplyId: number = 0;
  private processedMap: Map<string, { status: 'applied' | 'skipped' | 'failed'; dateStr: string }> = new Map();

  constructor() {
    this.load();
  }

  private rebuildIndex(): void {
    this.processedMap.clear();
    for (const date in this.data) {
      for (const status of ['applied', 'skipped', 'failed'] as const) {
        for (const record of this.data[date][status]) {
          this.processedMap.set(record.jobId, { status: record.status, dateStr: date });
        }
      }
    }
  }

  private getTodayDateString(): string {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localTime = new Date(now.getTime() - tzOffset);
    return localTime.toISOString().split('T')[0];
  }

  private load(): void {
    try {
      if (fs.existsSync(config.dbPath)) {
        const rawData = fs.readFileSync(config.dbPath, 'utf8');
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
           this.save();
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
        this.save();
      }
      this.rebuildIndex();
    } catch (error) {
      console.error('Failed to load database. Halting to prevent data loss or silent error:', error);
      throw error;
    }
  }

  private save(): void {
    try {
      const tmp = config.dbPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, config.dbPath);
    } catch (error) {
      console.error('Failed to save database. Halting to prevent silent write error:', error);
      throw error;
    }
  }

  public getNextApplyId(): number {
    this.currentApplyId++;
    return this.currentApplyId;
  }

  public hasBeenProcessed(jobId: string): boolean {
    const entry = this.processedMap.get(jobId);
    if (!entry) return false;
    if (entry.status === 'failed') return false;
    if (entry.status === 'skipped') {
      const recordDate = new Date(entry.dateStr);
      const now = new Date();
      const daysSince = Math.floor((now.getTime() - recordDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince >= 14) return false;
    }
    return true;
  }

  public addRecord(record: JobRecord): void {
    const today = this.getTodayDateString();
    if (!this.data[today]) {
      this.data[today] = { applied: [], skipped: [], failed: [] };
    }
    
    // Remove if it exists in failed from today
    this.data[today].failed = this.data[today].failed.filter(r => r.jobId !== record.jobId);
    
    this.data[today][record.status].push(record);
    this.processedMap.set(record.jobId, { status: record.status, dateStr: today });
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

export const db = new JobDatabase();
