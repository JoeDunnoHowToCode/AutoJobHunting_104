import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JobDatabase, JobRecord } from '../src/db';

/**
 * Lifecycle tests: these exercise *sequences* of operations, not single states.
 *
 * db-jsonl.spec.ts already asserts "a truncated final line is skipped". That
 * property held while the store was only ever read once. The failure that got
 * through was the sequence — truncate, then append, then read — where the
 * partial line stops being last and the store becomes permanently unreadable.
 */

function record(jobId: string, status: JobRecord['status']): JobRecord {
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
  };
}

describe('JobDatabase — 崩潰後續寫的生命週期', () => {
  let directory: string;
  let storePath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-resil-'));
    storePath = path.join(directory, 'applyRecord.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /** Writes a record, then simulates SIGKILL part-way through the next append. */
  function seedWithTornWrite(): void {
    const database = new JobDatabase(storePath);
    database.addRecord(record('before-crash', 'applied'));
    fs.appendFileSync(storePath, '{"jobId":"torn","stat', 'utf8');
  }

  it('截斷後首次載入仍讀得到既有紀錄', () => {
    seedWithTornWrite();
    expect(new JobDatabase(storePath).hasBeenProcessed('before-crash')).toBe(true);
  });

  // 這是實際會發生的序列，也是 262 個測試全綠卻沒擋住的那一條。
  it('截斷 → 續寫 → 再載入：不得拋錯', () => {
    seedWithTornWrite();
    const second = new JobDatabase(storePath);
    second.addRecord(record('after-crash', 'applied'));

    expect(() => new JobDatabase(storePath)).not.toThrow();
  });

  it('截斷 → 續寫 → 再載入：崩潰前後的紀錄都必須保留', () => {
    seedWithTornWrite();
    const second = new JobDatabase(storePath);
    second.addRecord(record('after-crash', 'applied'));

    const third = new JobDatabase(storePath);
    expect(third.hasBeenProcessed('before-crash')).toBe(true);
    expect(third.hasBeenProcessed('after-crash')).toBe(true);
  });

  it('載入時就修復殘行，檔案不再留下無法解析的內容', () => {
    seedWithTornWrite();
    new JobDatabase(storePath);

    for (const line of fs.readFileSync(storePath, 'utf8').split('\n').filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('連續兩次崩潰續寫仍可載入', () => {
    seedWithTornWrite();
    const second = new JobDatabase(storePath);
    second.addRecord(record('round-two', 'applied'));
    fs.appendFileSync(storePath, '{"jobId":"torn2"', 'utf8');

    const third = new JobDatabase(storePath);
    third.addRecord(record('round-three', 'applied'));

    const fourth = new JobDatabase(storePath);
    expect(fourth.hasBeenProcessed('before-crash')).toBe(true);
    expect(fourth.hasBeenProcessed('round-two')).toBe(true);
    expect(fourth.hasBeenProcessed('round-three')).toBe(true);
  });

  it('唯讀模式遇到殘行不得修改檔案', () => {
    seedWithTornWrite();
    const before = fs.readFileSync(storePath, 'utf8');
    new JobDatabase(storePath, { readOnly: true });
    expect(fs.readFileSync(storePath, 'utf8')).toBe(before);
  });
});

describe('JobDatabase — 中段損壞不得讓整個去重庫失效', () => {
  let directory: string;
  let storePath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-corrupt-'));
    storePath = path.join(directory, 'applyRecord.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // 拋錯會讓整個去重庫不可用，而「完全沒有去重」正是會造成重複投遞的狀態。
  // 略過損壞行並大聲回報，比整個停擺安全。
  it('中段有一行損壞時仍載入其餘紀錄', () => {
    const database = new JobDatabase(storePath);
    database.addRecord(record('first', 'applied'));
    fs.appendFileSync(storePath, 'this is not json\n', 'utf8');
    database.addRecord(record('third', 'applied'));

    const reloaded = new JobDatabase(storePath);
    expect(reloaded.hasBeenProcessed('first')).toBe(true);
    expect(reloaded.hasBeenProcessed('third')).toBe(true);
  });

  it('回報損壞行數供告警使用', () => {
    const database = new JobDatabase(storePath);
    database.addRecord(record('first', 'applied'));
    fs.appendFileSync(storePath, 'garbage one\ngarbage two\n', 'utf8');

    expect(new JobDatabase(storePath).corruptLineCount).toBe(2);
  });

  it('全新檔案的損壞行數為 0', () => {
    const database = new JobDatabase(storePath);
    database.addRecord(record('clean', 'applied'));
    expect(new JobDatabase(storePath).corruptLineCount).toBe(0);
  });
});

describe('JobDatabase — 舊格式路徑不得直接拋錯', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-legacypath-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  // 回退路徑：使用者把 dbPath 指回舊的 .json，或沿用舊設定檔。
  // 舊程式是 JSON.stringify(data, null, 2)，所以是多行 pretty-print。
  it('傳入 pretty-print 的舊 applyRecord.json 仍可讀取去重資料', () => {
    const legacyPath = path.join(directory, 'applyRecord.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify(
        { '2026-08-01': { applied: [record('legacy-applied', 'applied')], skipped: [], failed: [] } },
        null,
        2,
      ),
      'utf8',
    );

    let database!: JobDatabase;
    expect(() => { database = new JobDatabase(legacyPath); }).not.toThrow();
    expect(database.hasBeenProcessed('legacy-applied')).toBe(true);
  });
});
