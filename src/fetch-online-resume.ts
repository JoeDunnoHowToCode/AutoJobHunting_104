import { chromium } from 'playwright';
import { config } from './config';
import * as fs from 'fs';
import * as path from 'path';

async function fetchAndSaveOnlineResume() {
  console.log('==================================================');
  console.log('開始執行 104 線上履歷抓取與匯出');
  console.log('==================================================');

  if (!fs.existsSync(config.authStatePath)) {
    console.error(`❌ 找不到登入憑證 ${config.authStatePath}，請先執行 npm run login。`);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: config.authStatePath });
  const page = await context.newPage();

  let overviewData: any = null;
  const resumeBlocks: Record<string, any> = {};

  // 1. 攔截 104 AJAX API
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/profile/ajax/overview') && response.status() === 200) {
      try {
        overviewData = await response.json();
        console.log('✅ [API 攔截成功] 抓取到 104 履歷列表 Overview');
      } catch (e) {}
    }

    if (url.includes('/profile/ajax/resumeByBlock') && response.status() === 200) {
      try {
        const json = await response.json();
        const urlObj = new URL(url);
        const vno = urlObj.searchParams.get('vno') || 'default';
        resumeBlocks[vno] = json;
        console.log(`✅ [API 攔截成功] 抓取到履歷 Block 資料 (vno: ${vno})`);
      } catch (e) {}
    }
  });

  try {
    console.log('1. 前往 104 履歷頁面 (https://pda.104.com.tw/profile/)...');
    await page.goto('https://pda.104.com.tw/profile/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    // 點擊第一份履歷進入編輯頁觸發全量載入
    console.log('2. 點擊進入目標履歷內頁觸發完整資料載入...');
    const targetElement = page.locator('div, section, article, li, button, a').filter({ hasText: 'AI Engineer' }).last();
    if (await targetElement.count() > 0) {
      await targetElement.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    // 擷取 DOM 完全渲染之純文字
    const domText = await page.evaluate(() => {
      const container = document.querySelector('main') || document.querySelector('#app') || document.body;
      return container ? (container as HTMLElement).innerText : '';
    });

    const exportPath = path.resolve(__dirname, '..', 'online_resume_extracted.json');

    const resultPayload = {
      extractedAt: new Date().toISOString(),
      sourceUrl: page.url(),
      title: await page.title(),
      overview: overviewData,
      resumeDetailsByVno: resumeBlocks,
      domRenderedText: domText.replace(/\n+/g, '\n').trim()
    };

    fs.writeFileSync(exportPath, JSON.stringify(resultPayload, null, 2), 'utf8');

    console.log('\n==================================================');
    console.log(`🎉 104 線上履歷資料成功匯出至以下檔案：`);
    console.log(`📍 檔案路徑: ${exportPath}`);
    console.log(`📊 檔案大小: ${(fs.statSync(exportPath).size / 1024).toFixed(2)} KB`);
    console.log('==================================================');

  } catch (error: any) {
    console.error('❌ 執行發生錯誤:', error.message || error);
  } finally {
    await browser.close();
  }
}

fetchAndSaveOnlineResume();
