import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import PQueue from 'p-queue';
import { retryTransient } from '../src/ai/retry';
import { JobDatabase, JobRecord } from '../src/db';
import { PipelineState } from '../src/pipeline-state';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
    processedAt: '12:00:00',
  };
}

async function run(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-pipeline-'));
  const databasePath = path.join(directory, 'applyRecord.json');

  try {
    console.log('[1/5] DB 索引保留 applied 優先語意');
    fs.writeFileSync(databasePath, JSON.stringify({
      '2026-08-01': { applied: [record('applied-then-failed', 'applied')], skipped: [], failed: [] },
      '2026-08-13': { applied: [], skipped: [], failed: [record('applied-then-failed', 'failed')] },
    }), 'utf8');
    const database = new JobDatabase(databasePath);
    assert(database.hasBeenProcessed('applied-then-failed'), '已成功投遞的職缺不得因後續 failed 紀錄而解鎖');
    assert(!database.hasBeenProcessed('new-job'), '未記錄職缺應可處理');

    console.log('[2/5] PipelineState 去重、窗口與名額釋放');
    const state = new PipelineState();
    assert(state.tryStart('one', database), '首次工作應可進入');
    assert(!state.tryStart('one', database), '同一 jobId 不得重複進入');
    assert(!state.canAcceptMore(1), '達到 in-flight 上限時必須背壓');
    assert(state.reserveApply('one', 0, 1), '應可保留唯一投遞名額');
    state.releaseApply('one');
    assert(state.reservedApplyCount === 0, '生成失敗後名額必須歸還');
    state.finish('one');
    assert(state.inFlightCount === 0, '完成後 in-flight 鎖必須釋放');

    console.log('[3/5] Apply queue 嚴格單線');
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
    assert(maximum === 1, `Apply queue 不可併發，實際最大值為 ${maximum}`);

    console.log('[4/5] 只重試暫時性 LLM 錯誤');
    let permanentAttempts = 0;
    await retryTransient(async () => {
      permanentAttempts++;
      throw new Error('Schema validation failed');
    }, 'permanent-error-test').catch(() => undefined);
    assert(permanentAttempts === 1, 'Schema 驗證錯誤不得重試');

    let transientAttempts = 0;
    await retryTransient(async () => {
      transientAttempts++;
      if (transientAttempts === 1) throw { status: 429, message: 'rate limit' };
      return undefined;
    }, 'transient-error-test', 2);
    assert(transientAttempts === 2, '429 應重試一次');

    console.log('[5/5] 隔離測試不寫入專案 applyRecord.json');
    database.addRecord(record('isolated-test-job', 'skipped'));
    assert(fs.existsSync(databasePath), '測試 DB 應寫入暫存目錄');
    console.log('PASS: Pipeline 核心離線測試完成');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
