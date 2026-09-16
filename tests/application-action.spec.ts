import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Page } from 'playwright';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  executeApplicationAction,
  getRuntimePipelineLimits,
  resolveRunMode,
} from '../src/application-action';
import { JobDatabase } from '../src/db';
import {
  ApplicationPreflightResult,
  JobPlatform,
  ScrapedJob,
} from '../src/platforms/base';

class FakePlatform extends JobPlatform {
  public readonly platformName = 'fake';
  public preflightCalls = 0;
  public submissionCalls = 0;
  public pauseBeforeClose = false;

  public async searchJobs(_page: Page, _keyword: string): Promise<ScrapedJob[]> {
    return [];
  }

  public async getJobDescription(_page: Page, _jobUrl: string): Promise<{ jdText: string; location: string }> {
    return { jdText: '', location: '' };
  }

  public async verifyLogin(): Promise<boolean> {
    return true;
  }

  public async preflightApplication(
    _jobId: string,
    options?: { pauseBeforeClose?: boolean },
  ): Promise<ApplicationPreflightResult> {
    this.preflightCalls++;
    this.pauseBeforeClose = options?.pauseBeforeClose ?? false;
    return { status: 'ready_for_review', message: 'test preflight' };
  }

  public async applyToJob(_jobId: string, _coverLetter: string): Promise<boolean> {
    this.submissionCalls++;
    return true;
  }
}

const liveLimits = {
  jdConcurrency: 3,
  aiConcurrency: 4,
  maxApplyQueueSize: 5,
  resumeApplyQueueSize: 2,
  maxInFlightJobs: 8,
};

describe('resolveRunMode', () => {
  it('--dry-run 必須啟用唯讀模式', () => {
    expect(resolveRunMode(['node', 'index.ts', '--dry-run'])).toBe('dry-run');
  });

  it('未指定旗標時必須維持既有 live 行為', () => {
    expect(resolveRunMode(['node', 'index.ts'])).toBe('live');
  });
});

describe('getRuntimePipelineLimits', () => {
  it('dry-run 只允許單一、序列候選處理', () => {
    expect(getRuntimePipelineLimits('dry-run', liveLimits)).toEqual({
      jdConcurrency: 1,
      aiConcurrency: 1,
      maxApplyQueueSize: 1,
      resumeApplyQueueSize: 0,
      maxInFlightJobs: 1,
    });
  });

  it('live 模式未指定 applyLimit 時原封保留既有限制', () => {
    expect(getRuntimePipelineLimits('live', liveLimits)).toBe(liveLimits);
  });

  it('live 模式以 applyLimit 收斂佇列與 in-flight 上限', () => {
    expect(getRuntimePipelineLimits('live', liveLimits, 1)).toEqual({
      ...liveLimits,
      maxApplyQueueSize: 1,
      resumeApplyQueueSize: 0,
      maxInFlightJobs: 2,
    });
  });
});

describe('executeApplicationAction 模式隔離', () => {
  it('dry-run 走 preflight 且絕不呼叫 applyToJob', async () => {
    const platform = new FakePlatform();
    const preview = await executeApplicationAction('dry-run', platform, 'job-1', 'private cover letter', {
      preflight: { pauseBeforeClose: true },
    });

    expect(preview.type).toBe('preflight');
    expect(platform.preflightCalls).toBe(1);
    expect(platform.submissionCalls).toBe(0);
  });

  it('dry-run 必須把人工檢查暫停選項傳遞給 preflight', async () => {
    const platform = new FakePlatform();
    await executeApplicationAction('dry-run', platform, 'job-1', 'cover', {
      preflight: { pauseBeforeClose: true },
    });
    expect(platform.pauseBeforeClose).toBe(true);
  });

  it('live 模式走正式送出且不觸碰 preflight', async () => {
    const platform = new FakePlatform();
    const submission = await executeApplicationAction('live', platform, 'job-1', 'cover letter');

    expect(submission).toEqual({ type: 'submission', submitted: true });
    expect(platform.preflightCalls).toBe(0);
    expect(platform.submissionCalls).toBe(1);
  });
});

describe('唯讀資料庫不得建立或改寫 applyRecord', () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-dry-run-'));
    databasePath = path.join(directory, 'applyRecord.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('檔案不存在時不得建立檔案', () => {
    new JobDatabase(databasePath, { readOnly: true });
    expect(fs.existsSync(databasePath)).toBe(false);
  });

  it('空的唯讀資料庫仍可供去重查詢', () => {
    const database = new JobDatabase(databasePath, { readOnly: true });
    expect(database.hasBeenProcessed('new-job')).toBe(false);
  });

  it('不得配置 applyId', () => {
    const database = new JobDatabase(databasePath, { readOnly: true });
    expect(() => database.getNextApplyId()).toThrow(/read-only/);
  });

  it('必須拒絕 addRecord', () => {
    const database = new JobDatabase(databasePath, { readOnly: true });
    expect(() =>
      database.addRecord({
        jobId: 'new-job',
        title: 'Test job',
        company: 'Test company',
        location: 'Taipei',
        url: 'https://example.invalid/job',
        score: 0,
        reason: 'test',
        status: 'skipped',
        processedAt: '2026-08-26T12:00:00',
      }),
    ).toThrow(/read-only/);
  });
});

// These guard the structural safety property that a preview path cannot reach
// form mutation, even through a future refactor. They read source text because
// the property is about which code exists, not about runtime behaviour.
describe('104 preflight 原始碼不變式', () => {
  const platformSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src', 'platforms', 'platform104.ts'),
    'utf8',
  );
  const preflightStart = platformSource.indexOf('public async preflightApplication');
  const liveSubmitStart = platformSource.indexOf('public async applyToJob');
  const preflightSource = platformSource.slice(preflightStart, liveSubmitStart);
  const readOnlyPathSource = platformSource.slice(0, liveSubmitStart);

  it('找得到預期的 preflight / live 方法邊界', () => {
    expect(preflightStart).toBeGreaterThanOrEqual(0);
    expect(liveSubmitStart).toBeGreaterThan(preflightStart);
  });

  it.each([
    ['填寫表單欄位', /\.fill\(/],
    ['勾選表單選項', /\.check\(/],
    ['點擊任何表單控制項', /\.click\(/],
  ])('preflight 不得%s', (_label, pattern) => {
    expect(preflightSource).not.toMatch(pattern);
  });

  it.each([
    ['填寫欄位', /\.fill\(/],
    ['勾選選項', /\.check\(/],
    ['點擊最終送出按鈕', /submitButton\.click\(/],
  ])('正式送出 API 之前的任何 helper 都不得%s', (_label, pattern) => {
    expect(readOnlyPathSource).not.toMatch(pattern);
  });
});
