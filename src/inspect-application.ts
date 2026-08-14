import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Page } from 'playwright';
import { config } from './config';
import { Platform104, humanType } from './platforms/platform104';
import { LLMFactory } from './ai/factory';

function askQuestion(query: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return new Promise(resolve => setTimeout(resolve, 30000));
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    })
  );
}

async function attachErrorMonitor(page: Page, label: string) {
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[Browser ${label} ${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => {
    console.error(`[Browser ${label} PageError] ${err.message}`);
  });
}

async function run(): Promise<void> {
  console.log('==================================================');
  console.log('104 應徵全流程實體審查模式 (填入自薦信 + 停留在畫面)');
  console.log('==================================================');
  console.log('本腳本將執行：');
  console.log('1. 驗證 104 登入狀態');
  console.log('2. 搜尋職缺並讀取 JD');
  console.log('3. 呼叫 AI 進行評估並生成客製化自薦信');
  console.log('4. 開啟真實 104 應徵表單');
  console.log('5. 自動以擬真打字填入自薦信');
  console.log('6. ⚠️ 停留在表單畫面供您手動檢視，絕不點擊送出按鈕！');
  console.log('==================================================\n');

  const platform = new Platform104();
  const provider = LLMFactory.getProvider();

  let session: any = null;

  try {
    // 1. 驗證登入
    const isValidLogin = await platform.verifyLogin();
    if (!isValidLogin) {
      throw new Error('104 登入狀態無效，請先執行 npm run login。');
    }
    console.log('[1/5] 104 登入驗證成功。\n');

    // 2. 搜尋職缺
    console.log('[2/5] 搜尋符合條件之職缺...');
    const searchPage = await platform.getSearchPage();
    await attachErrorMonitor(searchPage, 'Search');

    const keyword = 'Generative AI 工程師';
    const jobs = await platform.searchJobs(searchPage, keyword, 1);
    await platform.closePage(searchPage);

    if (jobs.length === 0) {
      throw new Error(`關鍵字 "${keyword}" 未找到任何職缺。`);
    }

    const candidate = jobs[0];
    console.log(`\n選取候選職缺：${candidate.title} | ${candidate.company} (jobId: ${candidate.jobId})`);
    console.log(`職缺網址: ${candidate.url}`);

    // 3. 讀取 JD 與 AI 評估
    console.log('\n[3/5] 讀取職缺 JD 內容並由 AI 評估...');
    const detailPage = await platform.getDetailPage();
    await attachErrorMonitor(detailPage, 'Detail');
    const { jdText, location } = await platform.getJobDescription(detailPage, candidate.url);
    await platform.closePage(detailPage);

    console.log(`成功讀取 JD (長度: ${jdText.length} 字，地點: ${location})`);
    console.log(`正在呼叫 ${config.aiProvider} (${config.aiModel}) 進行結構化評估與自薦信生成...`);

    const evalResult = await provider.evaluateJob(candidate.title, candidate.company, jdText);
    console.log(`[AI 評估得分] ${evalResult.score} 分 | 決策: ${evalResult.decision || 'N/A'}`);
    console.log(`[AI 評估理由] ${evalResult.reason}`);

    const customization = await provider.generateCustomizedContent(
      candidate.title,
      candidate.company,
      jdText,
      {
        strengths: evalResult.strengths,
        gaps: evalResult.gaps,
        decision: evalResult.decision,
      }
    );

    console.log('\n================== 生成的客製化自薦信 ==================');
    console.log(customization.coverLetter);
    console.log('========================================================\n');

    // 4. 開啟應徵表單
    console.log('[4/5] 正在開啟 104 應徵表單...');
    session = await (platform as any).openApplicationForm(candidate.jobId);
    const formPage = session.targetPage;
    await attachErrorMonitor(formPage, 'FormPage');

    const inspection = await (platform as any).inspectForm(formPage);

    // 5. 填寫自薦信
    console.log('[5/5] 正在定位自薦信輸入框並進行擬真輸入...');
    if (!inspection.textarea) {
      throw new Error('未找到可輸入的自薦信欄位！');
    }

    await humanType(inspection.textarea, customization.coverLetter);
    console.log('✅ 自薦信已成功填入！');

    // 檢查頁面上的所有提示、錯誤與勾選框狀態
    console.log('\n================== 網頁狀態即時審查 ==================');
    const pageErrors = await formPage.locator('.text-danger, .error-msg, [class*="error"], [class*="alert"], [role="alert"]').allInnerTexts().catch(() => []);
    if (pageErrors.length > 0) {
      console.log('⚠️ 網頁畫面上出現的提示/警示文字:');
      for (const err of pageErrors) {
        if (err.trim()) console.log(` - ${err.trim()}`);
      }
    } else {
      console.log('✅ 畫面上未偵測到任何紅字或錯誤警示。');
    }

    console.log(`偵測到 ${inspection.result.visibleCheckboxCount} 個可見 Checkbox（未勾選數: ${inspection.result.uncheckedCheckboxCount}）。`);

    // 儲存截圖
    const screenshotPath = path.resolve(__dirname, '..', 'plans', 'application_preview.png');
    await formPage.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 畫面已完整截圖並存檔至: ${screenshotPath}`);
    console.log('========================================================\n');

    console.log('🔔 瀏覽器目前已停留在應徵表單畫面（已填入自薦信，未點擊送出）。');
    console.log('請切換至 Chrome 視窗親自檢視畫面狀態與表單細節。');
    await askQuestion('\n檢視完畢後，請在終端機按 [Enter] 鍵安全關閉瀏覽器（不會發送應徵）...');

  } finally {
    if (session) {
      await (platform as any).closeApplicationForm(session);
    }
    await platform.closeBrowsers();
    console.log('瀏覽器已安全關閉。');
  }
}

run().catch(err => {
  console.error('審查模式執行失敗:', err);
  process.exitCode = 1;
});
