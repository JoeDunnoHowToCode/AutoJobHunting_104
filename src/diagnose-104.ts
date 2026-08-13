import * as fs from 'fs';
import { Page } from 'playwright';
import { config } from './config';
import { Platform104 } from './platforms/platform104';

function firstSearchKeyword(): string {
  const resume = JSON.parse(fs.readFileSync(config.resumePath, 'utf8'));
  const desiredTitle = resume.basic_info?.desired_title || '';
  const keyword = desiredTitle.split(/[,、]/).map((value: string) => value.trim()).find(Boolean);
  if (!keyword) throw new Error('resume.json 的 basic_info.desired_title 沒有可用的搜尋關鍵字。');
  return keyword;
}

function requestedJobId(): string | null {
  const flagIndex = process.argv.indexOf('--job-id');
  if (flagIndex === -1) return null;
  const jobId = process.argv[flagIndex + 1]?.trim();
  if (!jobId || !/^[a-zA-Z0-9]+$/.test(jobId)) {
    throw new Error('--job-id 必須是單一 104 職缺 ID，例如 --job-id 8x8yl。');
  }
  return jobId;
}

/**
 * A deliberately read-only 104 diagnostic. It never calls an LLM, opens an
 * application form, writes the local database, or sends any notification.
 */
async function run(): Promise<void> {
  if (!fs.existsSync(config.authStatePath)) {
    throw new Error(`找不到登入 Session 檔案: ${config.authStatePath}；請先執行 npm run login。`);
  }
  if (!fs.existsSync(config.resumePath)) {
    throw new Error(`找不到履歷檔案: ${config.resumePath}`);
  }

  const platform = new Platform104();
  let searchPage: Page | null = null;
  let detailPage: Page | null = null;
  try {
    console.log('[104 diagnose] 唯讀模式：只驗證登入、搜尋與一筆 JD；不會開啟應徵表單。');
    if (!await platform.verifyLogin()) {
      throw new Error('104 登入或平台存取驗證失敗；請查看上方 [104 diagnostic]。');
    }

    const explicitJobId = requestedJobId();
    let jobId: string;
    let jobUrl: string;
    if (explicitJobId) {
      jobId = explicitJobId;
      jobUrl = `https://www.104.com.tw/job/${jobId}`;
      console.log(`[104 diagnose] 直接唯讀檢查指定 JD：${jobId}`);
    } else {
      const keyword = firstSearchKeyword();
      searchPage = await platform.getSearchPage();
      const jobs = await platform.searchJobs(searchPage, keyword, 1);
      if (jobs.length === 0) throw new Error('104 搜尋沒有取得可診斷的職缺。');
      jobId = jobs[0].jobId;
      jobUrl = jobs[0].url;
      console.log(`[104 diagnose] 只讀取第一筆搜尋結果的 JD：${jobId}`);
    }

    detailPage = await platform.getDetailPage();
    const jd = await platform.getJobDescription(detailPage, jobUrl);
    if (jd.jdText.trim().length === 0) throw new Error('104 回傳職缺頁，但沒有可辨識的 JD 文字。');
    console.log(`[104 diagnose] PASS jobId=${jobId} jdLength=${jd.jdText.length} location=${jd.location}`);
  } finally {
    if (searchPage) await platform.closePage(searchPage);
    if (detailPage) await platform.closePage(detailPage);
    await platform.closeBrowsers();
  }
}

run().catch(error => {
  console.error('[104 diagnose] FAIL:', error);
  process.exitCode = 1;
});
