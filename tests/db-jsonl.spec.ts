import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobDatabase, JobRecord } from '../src/db';

function record(jobId: string, status: JobRecord['status'], overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    jobId,
    title: 'Test job',
    company: 'Test company',
    location: 'Taipei',
    url: 'https://example.invalid/job',
    score: 70,
    reason: 'test',
    status,
    processedAt: '2026-08-26T12:00:00',
    ...overrides,
  };
}

function emptyDay() {
  return { applied: [] as JobRecord[], skipped: [] as JobRecord[], failed: [] as JobRecord[] };
}

describe('JobDatabase — append-only JSONL', () => {
  let directory: string;
  let jsonlPath: string;
  let legacyPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-jsonl-'));
    jsonlPath = path.join(directory, 'applyRecord.jsonl');
    legacyPath = path.join(directory, 'applyRecord.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function readLines(): string[] {
    return fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean);
  }

  it('addRecord 只 append 一行，不重寫整個檔案', () => {
    const database = new JobDatabase(jsonlPath);
    database.addRecord(record('first', 'skipped'));
    const afterFirst = fs.readFileSync(jsonlPath, 'utf8');

    database.addRecord(record('second', 'skipped'));
    const afterSecond = fs.readFileSync(jsonlPath, 'utf8');

    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    expect(readLines()).toHaveLength(2);
  });

  it('每一行都是可獨立解析的 JSON', () => {
    const database = new JobDatabase(jsonlPath);
    database.addRecord(record('a', 'applied'));
    database.addRecord(record('b', 'skipped', { reason: '含\n換行與"引號"' }));

    for (const line of readLines()) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(JSON.parse(readLines()[1]).reason).toBe('含\n換行與"引號"');
  });

  it('重新載入後的去重索引與寫入時一致', () => {
    const writer = new JobDatabase(jsonlPath);
    writer.addRecord(record('applied-job', 'applied'));
    writer.addRecord(record('skipped-job', 'skipped'));

    const reader = new JobDatabase(jsonlPath);
    expect(reader.hasBeenProcessed('applied-job')).toBe(true);
    expect(reader.hasBeenProcessed('skipped-job')).toBe(true);
    expect(reader.hasBeenProcessed('unseen-job')).toBe(false);
  });

  it('failed 紀錄即使寫入也不參與去重', () => {
    const writer = new JobDatabase(jsonlPath);
    writer.addRecord(record('failed-job', 'failed'));
    expect(new JobDatabase(jsonlPath).hasBeenProcessed('failed-job')).toBe(false);
  });

  it('最後一行不完整（模擬 SIGKILL）時忽略該行，其餘正常載入', () => {
    const writer = new JobDatabase(jsonlPath);
    writer.addRecord(record('intact', 'applied'));
    fs.appendFileSync(jsonlPath, '{"jobId":"truncated","stat', 'utf8');

    const reader = new JobDatabase(jsonlPath);
    expect(reader.hasBeenProcessed('intact')).toBe(true);
    expect(reader.hasBeenProcessed('truncated')).toBe(false);
  });

  it('applyId 遞增且不重複', () => {
    const database = new JobDatabase(jsonlPath);
    const ids = [
      database.getNextApplyId(),
      database.getNextApplyId(),
      database.getNextApplyId(),
    ];
    expect(ids).toEqual([1, 2, 3]);
  });

  it('重新載入後 applyId 從既有最大值續編', () => {
    const writer = new JobDatabase(jsonlPath);
    writer.addRecord(record('a', 'applied', { applyId: 7 }));
    expect(new JobDatabase(jsonlPath).getNextApplyId()).toBe(8);
  });

  it('唯讀模式不得建立檔案也不得寫入', () => {
    const database = new JobDatabase(jsonlPath, { readOnly: true });
    expect(fs.existsSync(jsonlPath)).toBe(false);
    expect(() => database.addRecord(record('x', 'skipped'))).toThrow(/read-only/);
    expect(() => database.getNextApplyId()).toThrow(/read-only/);
  });
});

describe('JobDatabase — 自舊版 applyRecord.json 遷移', () => {
  let directory: string;
  let jsonlPath: string;
  let legacyPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-migrate-'));
    jsonlPath = path.join(directory, 'applyRecord.jsonl');
    legacyPath = path.join(directory, 'applyRecord.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('JSONL 不存在但舊檔存在時自動遷移，去重語意不變', () => {
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        '2026-08-01': { ...emptyDay(), applied: [record('old-applied', 'applied', { applyId: 3 })] },
        '2026-08-20': { ...emptyDay(), skipped: [record('old-skipped', 'skipped')] },
        '2026-01-01': { ...emptyDay(), failed: [record('old-failed', 'failed')] },
      }),
      'utf8',
    );

    const database = new JobDatabase(jsonlPath);
    expect(fs.existsSync(jsonlPath)).toBe(true);
    expect(database.hasBeenProcessed('old-applied')).toBe(true);
    expect(database.hasBeenProcessed('old-failed')).toBe(false);
  });

  it('遷移保留原本的日期分桶資訊，讓 skipped TTL 仍以原日期計算', () => {
    const staleDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ [staleDate]: { ...emptyDay(), skipped: [record('stale', 'skipped')] } }),
      'utf8',
    );

    // 20 天前的 skipped 已超過 14 天 TTL，遷移後仍必須是可重新評估的
    expect(new JobDatabase(jsonlPath).hasBeenProcessed('stale')).toBe(false);
  });

  it('遷移保留最大 applyId', () => {
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        '2026-08-01': {
          ...emptyDay(),
          applied: [record('a', 'applied', { applyId: 11 }), record('b', 'applied', { applyId: 42 })],
        },
      }),
      'utf8',
    );
    expect(new JobDatabase(jsonlPath).getNextApplyId()).toBe(43);
  });

  it('遷移只執行一次，第二次啟動不重複匯入', () => {
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ '2026-08-01': { ...emptyDay(), applied: [record('a', 'applied')] } }),
      'utf8',
    );
    new JobDatabase(jsonlPath);
    const lineCount = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).length;

    new JobDatabase(jsonlPath);
    const afterSecond = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).length;

    expect(afterSecond).toBe(lineCount);
  });

  it('唯讀模式不得執行遷移', () => {
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ '2026-08-01': { ...emptyDay(), applied: [record('a', 'applied')] } }),
      'utf8',
    );
    const database = new JobDatabase(jsonlPath, { readOnly: true });

    expect(fs.existsSync(jsonlPath)).toBe(false);
    // 仍必須能讀到舊資料做去重
    expect(database.hasBeenProcessed('a')).toBe(true);
  });
});
