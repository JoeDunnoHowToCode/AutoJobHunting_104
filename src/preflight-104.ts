import * as fs from 'fs';
import { config } from './config';
import { Platform104 } from './platforms/platform104';

function requestedJobId(): string {
  const flagIndex = process.argv.indexOf('--job-id');
  const jobId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]?.trim();
  if (!jobId || !/^[a-zA-Z0-9]+$/.test(jobId)) {
    throw new Error('請指定單一 104 職缺 ID，例如 npm run preflight-104:review -- 8kbs5。');
  }
  return jobId;
}

/**
 * A narrow, no-resume pre-submit check for one known job. It intentionally
 * avoids the search pipeline and every LLM, database, notification, and final
 * submission path. Opening the application form is still a real 104 page
 * interaction, so callers must use it sparingly and only for manual review.
 */
async function run(): Promise<void> {
  if (!fs.existsSync(config.userDataDir) && !fs.existsSync(config.authStatePath)) {
    throw new Error(`找不到登入狀態或 Profile 目錄；請先執行 npm run login。`);
  }

  const jobId = requestedJobId();
  const platform = new Platform104();
  try {
    console.log('[104 preflight] 唯讀送出前檢查：不讀履歷、不呼叫 LLM、不寫入、不填寫、不勾選、不送出。');
    if (!await platform.verifyLogin()) {
      throw new Error('104 登入或平台存取驗證失敗；請查看上方 [104 diagnostic]。');
    }

    const result = await platform.preflightApplication(jobId, { pauseBeforeClose: true });
    console.log(`[104 preflight] status=${result.status}`);
    console.log(`[104 preflight] ${result.message}`);
    if (result.form) {
      console.log(
        `[104 preflight] textarea=${result.form.textareaFound}/${result.form.textareaVisible}/${result.form.textareaEnabled} ` +
        `submit=${result.form.submitButtonFound}/${result.form.submitButtonVisible}/${result.form.submitButtonEnabled} ` +
        `checkboxes=${result.form.visibleCheckboxCount} unchecked=${result.form.uncheckedCheckboxCount}`,
      );
    }

    if (result.status !== 'ready_for_review') {
      throw new Error(`送出前表單未達可人工審核狀態：${result.status}`);
    }
  } finally {
    await platform.closeBrowsers();
  }
}

run().catch(error => {
  console.error('[104 preflight] FAIL:', error);
  process.exitCode = 1;
});
