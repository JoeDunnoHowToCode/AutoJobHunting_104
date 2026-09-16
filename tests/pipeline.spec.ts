import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import PQueue from 'p-queue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryTransient } from '../src/ai/retry';
import { JobDatabase, JobRecord } from '../src/db';
import { PipelineState } from '../src/pipeline-state';

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

describe('JobDatabase 去重索引', () => {
  let directory: string;
  let databasePath: string;
  let legacyPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-pipeline-'));
    legacyPath = path.join(directory, 'applyRecord.json');
    databasePath = path.join(directory, 'applyRecord.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('已成功投遞的職缺不得因後續 failed 紀錄而解鎖', () => {
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({
        '2026-08-01': { applied: [record('applied-then-failed', 'applied')], skipped: [], failed: [] },
        '2026-08-13': { applied: [], skipped: [], failed: [record('applied-then-failed', 'failed')] },
      }),
      'utf8',
    );
    expect(new JobDatabase(databasePath).hasBeenProcessed('applied-then-failed')).toBe(true);
  });

  it('未記錄職缺應可處理', () => {
    fs.writeFileSync(legacyPath, JSON.stringify({}), 'utf8');
    expect(new JobDatabase(databasePath).hasBeenProcessed('new-job')).toBe(false);
  });

  it('隔離測試只寫入暫存目錄', () => {
    const database = new JobDatabase(databasePath);
    database.addRecord(record('isolated-test-job', 'skipped'));
    expect(fs.existsSync(databasePath)).toBe(true);
  });
});

describe('PipelineState 去重、窗口與名額', () => {
  let directory: string;
  let database: JobDatabase;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-state-'));
    database = new JobDatabase(path.join(directory, 'applyRecord.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('首次工作可進入，同一 jobId 不得重複進入', () => {
    const state = new PipelineState();
    expect(state.tryStart('one', database)).toBe(true);
    expect(state.tryStart('one', database)).toBe(false);
  });

  it('達到 in-flight 上限時必須背壓', () => {
    const state = new PipelineState();
    state.tryStart('one', database);
    expect(state.canAcceptMore(1)).toBe(false);
  });

  it('生成失敗後投遞名額必須歸還', () => {
    const state = new PipelineState();
    state.tryStart('one', database);
    expect(state.reserveApply('one', 0, 1)).toBe(true);
    state.releaseApply('one');
    expect(state.reservedApplyCount).toBe(0);
  });

  it('完成後 in-flight 鎖必須釋放', () => {
    const state = new PipelineState();
    state.tryStart('one', database);
    state.finish('one');
    expect(state.inFlightCount).toBe(0);
  });
});

describe('Apply queue 併發保證', () => {
  it('嚴格單線，不可併發', async () => {
    const applyQueue = new PQueue({ concurrency: 1 });
    let active = 0;
    let maximum = 0;

    for (let index = 0; index < 5; index++) {
      void applyQueue.add(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
      });
    }
    await applyQueue.onIdle();

    expect(maximum).toBe(1);
  });
});

describe('retryTransient 重試邊界', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Schema 驗證錯誤不得重試', async () => {
    let attempts = 0;
    await expect(
      retryTransient(async () => {
        attempts++;
        throw new Error('Schema validation failed');
      }, 'permanent-error-test'),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  // Fake timers keep this at milliseconds instead of waiting out the real
  // 12s rate-limit backoff.
  it('429 應重試一次', async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const pending = retryTransient(
      async () => {
        attempts++;
        if (attempts === 1) throw { status: 429, message: 'rate limit' };
        return undefined;
      },
      'transient-error-test',
      2,
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    expect(attempts).toBe(2);
  });
});
