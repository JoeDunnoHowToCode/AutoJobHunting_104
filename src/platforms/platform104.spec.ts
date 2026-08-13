import * as fs from 'fs';
import * as path from 'path';
import { classify104Navigation } from './platform104';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectClassification(
  expected: string,
  input: Parameters<typeof classify104Navigation>[0],
): void {
  const diagnostic = classify104Navigation(input);
  assert(diagnostic !== null, `預期 ${expected}，但沒有產生診斷`);
  assert(diagnostic.classification === expected, `預期 ${expected}，實際為 ${diagnostic.classification}`);
}

function run(): void {
  const job = { stage: 'job' as const, path: 'https://www.104.com.tw/job/example' };

  console.log('[1/11] 401 與登入導向必須分類為 Session 問題');
  expectClassification('authentication_required', { ...job, status: 401 });
  expectClassification('authentication_required', { ...job, loginRedirect: true });

  console.log('[2/11] 純 HTTP 403 不得誤稱為驗證頁');
  expectClassification('http_forbidden', { ...job, status: 403 });

  console.log('[3/11] 有明確驗證標記的 403 必須標為 challenge');
  expectClassification('challenge_required', { ...job, status: 403, markerIds: ['challenge'] });

  console.log('[4/11] 429 與頻率文字必須標為 rate limit');
  expectClassification('rate_limited', { ...job, status: 429 });
  expectClassification('rate_limited', { ...job, markerIds: ['rate_limit'] });

  console.log('[5/11] 5xx 與服務訊息必須標為暫時服務問題');
  expectClassification('service_unavailable', { ...job, status: 503 });
  expectClassification('service_unavailable', { ...job, markerIds: ['service_unavailable'] });

  console.log('[6/11] 缺少主文件回應與未知 JD 結構必須 fail closed');
  expectClassification('navigation_failed', { ...job, navigationFailed: true });
  expectClassification('page_unrecognized', { ...job, status: 200, expectedPageShape: false });

  console.log('[7/11] 正常 JD 頁不可產生限制診斷');
  assert(
    classify104Navigation({ ...job, status: 200, expectedPageShape: true }) === null,
    '正常 JD 頁不可被誤判為限制頁',
  );

  console.log('[8/11] JD、搜尋與應徵頁的 403 都必須 fail closed');
  const platformSource = fs.readFileSync(path.resolve(__dirname, 'platform104.ts'), 'utf8');
  const baseSource = fs.readFileSync(path.resolve(__dirname, 'base.ts'), 'utf8');
  assert(
    platformSource.includes('status === 403') && platformSource.includes('Stop the complete pipeline'),
    'JD 403 必須被明確分類為全流程停止條件',
  );
  assert(
    !platformSource.includes("stage === 'job' && status === 403 && diagnostic"),
    'JD 403 不得被降級為可略過職缺',
  );

  console.log('[9/11] 104 必須一律使用可見瀏覽器，避免已驗證的背景模式 403');
  assert(
    baseSource.includes('launchConfiguredBrowser({ headless: false })'),
    '104 平台必須強制採用可見瀏覽器模式',
  );

  console.log('[10/11] 公開搜尋、JD 與已登入頁面必須使用明確且正確的 Context');
  assert(baseSource.includes('protected publicContext'), '應維護公開搜尋 Context');
  assert(baseSource.includes('protected authenticatedContext'), '應維護已登入 Context');
  assert(baseSource.includes('storageState: config.authStatePath'), '已登入 Context 必須載入保存的 Session');
  const searchStart = baseSource.indexOf('public async getSearchPage');
  const searchEnd = baseSource.indexOf('\n  }', searchStart);
  assert(baseSource.slice(searchStart, searchEnd).includes('return this.getPublicPage()'), '搜尋必須使用共享公開 Context');
  const detailStart = baseSource.indexOf('public async getDetailPage');
  const detailEnd = baseSource.indexOf('\n  }', detailStart);
  assert(baseSource.slice(detailStart, detailEnd).includes('return this.getIsolatedDetailPage()'), 'JD 必須使用全新公開 Context');
  const applyStart = baseSource.indexOf('public async getApplyPage');
  const applyEnd = baseSource.indexOf('\n  }', applyStart);
  assert(baseSource.slice(applyStart, applyEnd).includes('return this.getAuthenticatedPage()'), '應徵頁必須使用已登入 Context');

  console.log('[11/11] 獨立 JD Context 關閉時必須連同瀏覽器釋放');
  assert(
    baseSource.includes('const isSharedContext = context === this.publicContext || context === this.authenticatedContext') &&
      baseSource.includes('await context.browser()?.close()'),
    'JD 使用的一次性 Context 必須在 closePage 時關閉其瀏覽器',
  );
}

try {
  run();
  console.log('PASS: 104 導覽分類與 Session Context 隔離測試完成');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
