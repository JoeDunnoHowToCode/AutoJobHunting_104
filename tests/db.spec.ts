import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobDatabase, JobRecord } from '../src/db';

function record(jobId: string, status: JobRecord['status']): JobRecord {
  return {
    jobId,
    title: 'Test job',
    company: 'Test company',
    location: 'Taipei',
    url: 'https://example.invalid/job',
    score: 0,
    reason: 'test',
    status,
    processedAt: '2026-08-26T12:00:00',
  };
}

function daysAgo(days: number): string {
  const now = new Date();
  const then = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const tzOffset = then.getTimezoneOffset() * 60000;
  return new Date(then.getTime() - tzOffset).toISOString().split('T')[0];
}

function emptyDay() {
  return { applied: [] as JobRecord[], skipped: [] as JobRecord[], failed: [] as JobRecord[] };
}

describe('JobDatabase.hasBeenProcessed', () => {
  let directory: string;
  let databasePath: string;
  let legacyPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-db-'));
    // 種入舊格式 applyRecord.json、開啟 applyRecord.jsonl：同時驗證
    // 去重語意與「遷移不得改變語意」這兩件事。
    legacyPath = path.join(directory, 'applyRecord.json');
    databasePath = path.join(directory, 'applyRecord.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function seed(data: Record<string, ReturnType<typeof emptyDay>>): JobDatabase {
    fs.writeFileSync(legacyPath, JSON.stringify(data), 'utf8');
    return new JobDatabase(databasePath);
  }

  it('完全無紀錄的職缺可處理', () => {
    expect(seed({}).hasBeenProcessed('never-seen')).toBe(false);
  });

  // D-01：這是整份體檢裡損失最大的缺陷。failed 紀錄目前沒有任何到期機制，
  // 導致 56 個職缺被永久排除，其中 31 筆只是 Gemini 回 429。
  it('只有 failed 紀錄的職缺不得視為已處理', () => {
    const database = seed({
      [daysAgo(1)]: { ...emptyDay(), failed: [record('only-failed', 'failed')] },
    });
    expect(database.hasBeenProcessed('only-failed')).toBe(false);
  });

  it('七個月前的 failed 紀錄同樣不得鎖住職缺', () => {
    const database = seed({
      '2026-01-01': { ...emptyDay(), failed: [record('ancient-failure', 'failed')] },
    });
    expect(database.hasBeenProcessed('ancient-failure')).toBe(false);
  });

  it('applied 紀錄永久鎖住職缺', () => {
    const database = seed({
      '2026-01-01': { ...emptyDay(), applied: [record('applied-long-ago', 'applied')] },
    });
    expect(database.hasBeenProcessed('applied-long-ago')).toBe(true);
  });

  it('applied 之後又出現 failed，仍必須維持鎖住（不得因失敗紀錄解鎖）', () => {
    const database = seed({
      '2026-08-01': { ...emptyDay(), applied: [record('applied-then-failed', 'applied')] },
      '2026-08-13': { ...emptyDay(), failed: [record('applied-then-failed', 'failed')] },
    });
    expect(database.hasBeenProcessed('applied-then-failed')).toBe(true);
  });

  it('13 天前的 skipped 仍在冷卻期內', () => {
    const database = seed({
      [daysAgo(13)]: { ...emptyDay(), skipped: [record('recent-skip', 'skipped')] },
    });
    expect(database.hasBeenProcessed('recent-skip')).toBe(true);
  });

  it('15 天前的 skipped 已過期，可重新評估', () => {
    const database = seed({
      [daysAgo(15)]: { ...emptyDay(), skipped: [record('stale-skip', 'skipped')] },
    });
    expect(database.hasBeenProcessed('stale-skip')).toBe(false);
  });

  it('failed 與過期 skipped 併存時仍可重新評估', () => {
    const database = seed({
      [daysAgo(20)]: { ...emptyDay(), skipped: [record('mixed', 'skipped')] },
      [daysAgo(2)]: { ...emptyDay(), failed: [record('mixed', 'failed')] },
    });
    expect(database.hasBeenProcessed('mixed')).toBe(false);
  });
});

describe('JobDatabase 唯讀模式', () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-db-ro-'));
    databasePath = path.join(directory, 'applyRecord.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('getNextApplyId 必須拒絕配號', () => {
    const database = new JobDatabase(databasePath, { readOnly: true });
    expect(() => database.getNextApplyId()).toThrow(/read-only/);
  });

  it('addRecord 必須拒絕寫入', () => {
    const database = new JobDatabase(databasePath, { readOnly: true });
    expect(() => database.addRecord(record('x', 'skipped'))).toThrow(/read-only/);
  });
});
