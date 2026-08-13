import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Page } from 'playwright';
import {
  executeApplicationAction,
  getRuntimePipelineLimits,
  resolveRunMode,
} from './application-action';
import { JobDatabase } from './db';
import {
  ApplicationPreflightResult,
  JobPlatform,
  ScrapedJob,
} from './platforms/base';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrows(action: () => void, message: string): void {
  let threw = false;
  try {
    action();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

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
    return {
      status: 'ready_for_review',
      message: 'test preflight',
    };
  }

  public async applyToJob(_jobId: string, _coverLetter: string): Promise<boolean> {
    this.submissionCalls++;
    return true;
  }
}

async function run(): Promise<void> {
  console.log('[1/6] --dry-run 只解析為明確唯讀模式');
  assert(resolveRunMode(['node', 'index.ts', '--dry-run']) === 'dry-run', '--dry-run 必須啟用唯讀模式');
  assert(resolveRunMode(['node', 'index.ts']) === 'live', '未指定旗標時必須維持既有 live 行為');

  console.log('[2/6] dry-run 僅允許單一、序列候選處理');
  const liveLimits = {
    jdConcurrency: 3,
    aiConcurrency: 4,
    maxApplyQueueSize: 5,
    resumeApplyQueueSize: 2,
    maxInFlightJobs: 8,
  };
  const dryRunLimits = getRuntimePipelineLimits('dry-run', liveLimits);
  assert(dryRunLimits.jdConcurrency === 1, 'dry-run JD 必須單線');
  assert(dryRunLimits.aiConcurrency === 1, 'dry-run AI 必須單線');
  assert(dryRunLimits.maxApplyQueueSize === 1, 'dry-run Apply queue 只能保留一筆');
  assert(dryRunLimits.resumeApplyQueueSize === 0, 'dry-run 不得在未清空時恢復 Producer');
  assert(dryRunLimits.maxInFlightJobs === 1, 'dry-run 只能有一個 in-flight 候選');
  assert(getRuntimePipelineLimits('live', liveLimits) === liveLimits, 'live 模式必須保留既有 pipeline 限制');

  console.log('[3/6] dry-run 不得呼叫正式送出 API');
  const dryRunPlatform = new FakePlatform();
  const preview = await executeApplicationAction('dry-run', dryRunPlatform, 'job-1', 'private cover letter', {
    preflight: { pauseBeforeClose: true },
  });
  assert(preview.type === 'preflight', 'dry-run 應回傳 preflight 結果');
  assert(dryRunPlatform.preflightCalls === 1, 'dry-run 必須呼叫 preflightApplication 一次');
  assert(dryRunPlatform.submissionCalls === 0, 'dry-run 絕不可呼叫 applyToJob');
  assert(dryRunPlatform.pauseBeforeClose, 'dry-run 必須將人工檢查暫停選項傳遞給 preflight');

  console.log('[4/6] live 模式才可呼叫正式送出 API');
  const livePlatform = new FakePlatform();
  const submission = await executeApplicationAction('live', livePlatform, 'job-1', 'cover letter');
  assert(submission.type === 'submission' && submission.submitted, 'live 模式應回傳正式送出結果');
  assert(livePlatform.preflightCalls === 0, 'live 模式不應走 preflight API');
  assert(livePlatform.submissionCalls === 1, 'live 模式必須呼叫 applyToJob 一次');

  console.log('[5/6] 唯讀資料庫不得建立或改寫 applyRecord');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-dry-run-'));
  const databasePath = path.join(directory, 'applyRecord.json');
  try {
    const database = new JobDatabase(databasePath, { readOnly: true });
    assert(!fs.existsSync(databasePath), '唯讀資料庫在檔案不存在時不得建立檔案');
    assert(!database.hasBeenProcessed('new-job'), '空的唯讀資料庫應可供去重查詢');
    expectThrows(() => database.getNextApplyId(), '唯讀資料庫不得配置 applyId');
    expectThrows(() => {
      database.addRecord({
        jobId: 'new-job',
        title: 'Test job',
        company: 'Test company',
        location: 'Taipei',
        url: 'https://example.invalid/job',
        score: 0,
        reason: 'test',
        status: 'skipped',
        processedAt: '12:00:00',
      });
    }, '唯讀資料庫必須拒絕 addRecord');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.log('[6/6] 104 preflight 方法不得修改或送出表單');
  const platformSource = fs.readFileSync(path.resolve(__dirname, 'platforms', 'platform104.ts'), 'utf8');
  const preflightStart = platformSource.indexOf('public async preflightApplication');
  const liveSubmitStart = platformSource.indexOf('public async applyToJob');
  assert(preflightStart >= 0 && liveSubmitStart > preflightStart, '找不到預期的 preflight / live 方法邊界');
  const preflightSource = platformSource.slice(preflightStart, liveSubmitStart);
  const readOnlyPathSource = platformSource.slice(0, liveSubmitStart);
  assert(!/\.fill\(/.test(preflightSource), 'preflight 不得填寫表單欄位');
  assert(!/\.check\(/.test(preflightSource), 'preflight 不得勾選表單選項');
  assert(!/\.click\(/.test(preflightSource), 'preflight 不得點擊任何表單控制項');
  assert(!/\.fill\(/.test(readOnlyPathSource), '正式送出 API 之前的任何 helper 都不得填寫欄位');
  assert(!/\.check\(/.test(readOnlyPathSource), '正式送出 API 之前的任何 helper 都不得勾選選項');
  assert(!/submitButton\.click\(/.test(readOnlyPathSource), '正式送出 API 之前不得點擊最終送出按鈕');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
