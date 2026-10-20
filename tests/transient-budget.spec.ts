import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransientLog } from '../src/transient-log';

/**
 * Sequence tests across runs.
 *
 * `transient` was defined as "leaves no trace, retry next round". Correct on
 * its own — it is what stops a quota outage from permanently excluding jobs.
 * But with no ceiling, a job that fails deterministically (a 104 layout change,
 * a consent box that never gets ticked) is re-attempted every single run:
 * a JD fetch, a *paid* LLM call, an apply slot and a full-page screenshot,
 * forever.
 *
 * The log was write-only until now. Reading it back is what turns "retry
 * forever" into "retry a bounded number of times, then let it settle".
 */

function entry(jobId: string, kind = 'form_unavailable') {
  return {
    jobId,
    title: 'Test job',
    stage: 'apply' as const,
    kind,
    reason: 'test failure',
  };
}

describe('TransientLog — 跨輪重試預算', () => {
  let directory: string;
  let logPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-tbudget-'));
    logPath = path.join(directory, 'logs', 'transient.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('全新紀錄的失敗次數為 0', () => {
    expect(new TransientLog(logPath).failureCountFor('never-seen')).toBe(0);
  });

  it('同一輪內累計次數', () => {
    const log = new TransientLog(logPath);
    log.append(entry('a'));
    log.append(entry('a'));
    expect(log.failureCountFor('a')).toBe(2);
  });

  // 這是關鍵序列：上一輪寫進去的次數，下一輪必須讀得回來。
  it('跨輪讀回既有次數', () => {
    const first = new TransientLog(logPath);
    first.append(entry('repeat-offender'));
    first.append(entry('repeat-offender'));

    expect(new TransientLog(logPath).failureCountFor('repeat-offender')).toBe(2);
  });

  it('不同 jobId 各自計數', () => {
    const log = new TransientLog(logPath);
    log.append(entry('a'));
    log.append(entry('b'));
    log.append(entry('b'));
    expect(log.failureCountFor('a')).toBe(1);
    expect(log.failureCountFor('b')).toBe(2);
  });

  it('未達預算時仍應重試', () => {
    const log = new TransientLog(logPath, { maxAttempts: 3 });
    log.append(entry('a'));
    log.append(entry('a'));
    expect(log.hasExhaustedBudget('a')).toBe(false);
  });

  it('達到預算後不再重試', () => {
    const log = new TransientLog(logPath, { maxAttempts: 3 });
    for (let i = 0; i < 3; i++) log.append(entry('a'));
    expect(log.hasExhaustedBudget('a')).toBe(true);
  });

  it('預算耗盡的判定可跨輪存活', () => {
    const first = new TransientLog(logPath, { maxAttempts: 3 });
    for (let i = 0; i < 3; i++) first.append(entry('a'));

    expect(new TransientLog(logPath, { maxAttempts: 3 }).hasExhaustedBudget('a')).toBe(true);
  });

  it('成功投遞後清除該職缺的失敗計數', () => {
    const log = new TransientLog(logPath, { maxAttempts: 3 });
    log.append(entry('a'));
    log.append(entry('a'));
    log.clear('a');
    expect(log.failureCountFor('a')).toBe(0);
    expect(log.hasExhaustedBudget('a')).toBe(false);
  });

  it('清除紀錄可跨輪存活', () => {
    const first = new TransientLog(logPath, { maxAttempts: 3 });
    for (let i = 0; i < 3; i++) first.append(entry('a'));
    first.clear('a');

    expect(new TransientLog(logPath, { maxAttempts: 3 }).hasExhaustedBudget('a')).toBe(false);
  });

  // 429、斷線、104 限流是整輪的問題，跟職缺本身無關；照樣扣額度的話，配額連續
  // 出問題三天就會把根本沒評估過的職缺排除 14 天。
  it.each(['rate_limited', 'network', 'platform_limited'])('%s 不扣額度，跨輪重新載入後也一樣', kind => {
    const first = new TransientLog(logPath);
    for (let i = 0; i < 3; i++) {
      first.append(entry('outage-hit', kind));
      first.append(entry('job-specific'));
    }
    expect(first.failureCountFor('outage-hit')).toBe(0);
    expect(first.failureCountFor('job-specific')).toBe(3);

    const reloaded = new TransientLog(logPath);
    expect(reloaded.failureCountFor('outage-hit')).toBe(0);
    expect(reloaded.failureCountFor('job-specific')).toBe(3);
  });

  // 失敗若永不過期，用完額度的職缺冷卻 14 天回來後，只要再失敗一次就又被排除。
  it('超過 14 天的失敗不再計入，14 天內的照常計入', () => {
    const aged = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(
      logPath,
      `${JSON.stringify({ ts: aged, ...entry('aged-out') })}\n`.repeat(3) +
        `${JSON.stringify({ ts: recent, ...entry('recent') })}\n`.repeat(3),
      'utf8',
    );

    const log = new TransientLog(logPath, { maxAttempts: 3 });
    expect(log.failureCountFor('aged-out')).toBe(0);
    expect(log.hasExhaustedBudget('recent')).toBe(true);
  });
});

describe('TransientLog — 保留既有寫入契約', () => {
  let directory: string;
  let logPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-tlog2-'));
    logPath = path.join(directory, 'logs', 'transient.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('append 不覆寫先前內容', () => {
    const log = new TransientLog(logPath);
    log.append(entry('first'));
    log.append(entry('second'));

    const ids = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)
      .map(line => JSON.parse(line).jobId);
    expect(ids).toEqual(['first', 'second']);
  });

  it('reason 含換行與引號時 JSONL 不被破壞', () => {
    const log = new TransientLog(logPath);
    const nasty = 'line one\nline two "quoted"';
    log.append({ ...entry('a'), reason: nasty });
    log.append(entry('b'));

    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).reason).toBe(nasty);
  });

  it('損壞行不得讓計數載入失敗', () => {
    const log = new TransientLog(logPath);
    log.append(entry('a'));
    fs.appendFileSync(logPath, 'not json at all\n', 'utf8');
    log.append(entry('a'));

    expect(new TransientLog(logPath).failureCountFor('a')).toBe(2);
  });

  it('寫入失敗不得中斷主流程', () => {
    fs.mkdirSync(logPath, { recursive: true });
    const log = new TransientLog(logPath);
    expect(() => log.append(entry('a'))).not.toThrow();
  });

  // 不修補的話，下一筆會黏在殘行後面一起解析失敗，次數卡住、額度永遠不會觸發。
  it('最後一行寫到一半：載入時截掉，之後的失敗照常計數', () => {
    const first = new TransientLog(logPath, { maxAttempts: 3 });
    first.append(entry('x'));
    first.append(entry('x'));
    fs.appendFileSync(logPath, '{"jobId":"x","sta', 'utf8');

    const second = new TransientLog(logPath, { maxAttempts: 3 });
    second.append(entry('x'));

    const third = new TransientLog(logPath, { maxAttempts: 3 });
    expect(third.failureCountFor('x')).toBe(3);
    expect(third.hasExhaustedBudget('x')).toBe(true);
  });

  it('最後一筆完整只缺換行：補回換行保留該筆，之後的失敗照常計數', () => {
    const first = new TransientLog(logPath, { maxAttempts: 3 });
    first.append(entry('x'));
    first.append(entry('x'));
    fs.writeFileSync(logPath, fs.readFileSync(logPath, 'utf8').replace(/\n$/, ''), 'utf8');

    const second = new TransientLog(logPath, { maxAttempts: 3 });
    second.append(entry('x'));

    const third = new TransientLog(logPath, { maxAttempts: 3 });
    expect(third.failureCountFor('x')).toBe(3);
    expect(third.hasExhaustedBudget('x')).toBe(true);
  });
});
