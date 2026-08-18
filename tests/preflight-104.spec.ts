import * as fs from 'fs';
import * as path from 'path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function run(): void {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'preflight-104.ts'), 'utf8');
  const packageJson = fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8');

  console.log('[1/3] 單筆 preflight 必須要求明確 job ID');
  assert(source.includes("process.argv.indexOf('--job-id')"), 'preflight 必須要求 --job-id，避免批次掃描');

  console.log('[2/3] 單筆 preflight 不得讀取履歷、呼叫 LLM、寫入或送出');
  for (const forbidden of ['resumePath', 'LLMFactory', 'JobDatabase', 'saveToNotion', 'sendTelegramMessage', 'applyToJob']) {
    assert(!source.includes(forbidden), `preflight 不得包含 ${forbidden}`);
  }
  assert(source.includes('preflightApplication(jobId, { pauseBeforeClose: true })'), 'preflight 必須只呼叫唯讀表單檢查');

  console.log('[3/3] package script 必須強制可見模式');
  assert(
    packageJson.includes('"preflight-104:review": "AUTOJOB_HEADLESS=false ts-node src/preflight-104.ts --job-id"'),
    'preflight 指令必須使用可見模式並要求 --job-id',
  );
}

try {
  run();
  console.log('PASS: 單筆 104 preflight 安全邊界測試完成');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
