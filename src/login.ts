import * as readline from 'readline';
import * as fs from 'fs';
import { config } from './config';
import { launchConfiguredBrowser } from './browser';
import { filter104StorageState } from './session-state';

function askQuestion(query: string): Promise<string> {
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

async function run() {
  console.log('==================================================');
  console.log('104 人力銀行 自動化登入 Session 產生器');
  console.log('==================================================');
  console.log('這將會開啟一個可見的瀏覽器視窗。');
  console.log('請在瀏覽器中手動完成登入（包含填寫帳密、處理驗證碼等）。');
  console.log('==================================================\n');

  const browser = await launchConfiguredBrowser({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei'
  });
  
  const page = await context.newPage();
  
  console.log('正在導向 104 首頁...');
  await page.goto('https://www.104.com.tw/', { waitUntil: 'domcontentloaded' });
  
  // 未來若要加入其他平台，可以在此解除註解
  // const page2 = await context.newPage();
  // await page2.goto('https://www.cakeresume.com/', { waitUntil: 'domcontentloaded' });
  // const page3 = await context.newPage();
  // await page3.goto('https://www.yourator.co/', { waitUntil: 'domcontentloaded' });

  console.log('\n[提示] 請在瀏覽器視窗中完成 104 的登入。');
  console.log('成功進入會員後台（或首頁確認已登入狀態）後，請回到此終端機：');
  
  await askQuestion('按 [Enter] 鍵以儲存登入 Session 狀態並關閉瀏覽器...');

  console.log('正在儲存 104 登入狀態至:', config.authStatePath);
  const storageState = await context.storageState();
  const filteredState = filter104StorageState(storageState);
  fs.writeFileSync(config.authStatePath, JSON.stringify(filteredState, null, 2), { mode: 0o600 });
  fs.chmodSync(config.authStatePath, 0o600);
  console.log('登入狀態儲存成功（僅保留 104 網域狀態）。');

  await browser.close();
  console.log('瀏覽器已關閉。104 流程會固定使用可見 Chrome；請先執行單筆 preflight 確認送出前表單可存取。');
}

run().catch(error => {
  console.error('執行過程中發生錯誤:', error);
});
