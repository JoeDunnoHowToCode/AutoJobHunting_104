import * as readline from 'readline';
import * as fs from 'fs';
import { config } from './config';
import { launchStealthPersistentContext } from './browser';
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
  console.log('104 人力銀行 自動化登入 Profile 管理器 (Persistent)');
  console.log('==================================================');
  console.log('這將會開啟帶有特徵抹除的真實 Chrome 瀏覽器視窗。');
  console.log('請在瀏覽器中手動完成登入（包含填寫帳密、處理驗證碼等）。');
  console.log('登入後的 Session 將自動持久化儲存於 .chrome-profile 目錄。');
  console.log('==================================================\n');

  const context = await launchStealthPersistentContext(config.userDataDir, { headless: false });
  const page = context.pages()[0] || await context.newPage();
  
  console.log('正在導向 104 首頁...');
  await page.goto('https://www.104.com.tw/', { waitUntil: 'domcontentloaded' });

  console.log('\n[提示] 請在瀏覽器視窗中完成 104 的登入。');
  console.log('成功進入會員後台（或首頁確認已登入狀態）後，請回到此終端機：');
  
  await askQuestion('按 [Enter] 鍵以儲存登入狀態並關閉瀏覽器...');

  // Also write auth_state.json for backward compatibility
  try {
    const storageState = await context.storageState();
    const filteredState = filter104StorageState(storageState);
    fs.writeFileSync(config.authStatePath, JSON.stringify(filteredState, null, 2), { mode: 0o600 });
    fs.chmodSync(config.authStatePath, 0o600);
    console.log('備援 Session 檔案寫入成功:', config.authStatePath);
  } catch (e) {
    // Ignore if export fails
  }

  console.log(`\n登入 Profile 已成功持久化至: ${config.userDataDir}`);
  await context.close();
  console.log('瀏覽器已安全關閉。');
}

run().catch(error => {
  console.error('執行過程中發生錯誤:', error);
});
