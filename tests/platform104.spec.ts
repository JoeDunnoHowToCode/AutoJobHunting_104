import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { classify104Navigation } from '../src/platforms/platform104';

const job = { stage: 'job' as const, path: 'https://www.104.com.tw/job/example' };

function classificationOf(input: Parameters<typeof classify104Navigation>[0]): string | null {
  return classify104Navigation(input)?.classification ?? null;
}

const platformSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'platforms', 'platform104.ts'),
  'utf8',
);
const baseSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'platforms', 'base.ts'),
  'utf8',
);

describe('classify104Navigation', () => {
  it('401 必須分類為 Session 問題', () => {
    expect(classificationOf({ ...job, status: 401 })).toBe('authentication_required');
  });

  it('登入導向必須分類為 Session 問題', () => {
    expect(classificationOf({ ...job, loginRedirect: true })).toBe('authentication_required');
  });

  it('純 HTTP 403 不得誤稱為驗證頁', () => {
    expect(classificationOf({ ...job, status: 403 })).toBe('http_forbidden');
  });

  it('有明確驗證標記的 403 必須標為 challenge', () => {
    expect(classificationOf({ ...job, status: 403, markerIds: ['challenge'] })).toBe(
      'challenge_required',
    );
  });

  it.each([
    ['429 狀態碼', { ...job, status: 429 }],
    ['頻率限制文字標記', { ...job, markerIds: ['rate_limit'] }],
  ])('%s 必須標為 rate limit', (_label, input) => {
    expect(classificationOf(input)).toBe('rate_limited');
  });

  it.each([
    ['503 狀態碼', { ...job, status: 503 }],
    ['服務訊息標記', { ...job, markerIds: ['service_unavailable'] }],
  ])('%s 必須標為暫時服務問題', (_label, input) => {
    expect(classificationOf(input)).toBe('service_unavailable');
  });

  it('缺少主文件回應必須 fail closed', () => {
    expect(classificationOf({ ...job, navigationFailed: true })).toBe('navigation_failed');
  });

  it('未知 JD 結構必須 fail closed', () => {
    expect(classificationOf({ ...job, status: 200, expectedPageShape: false })).toBe(
      'page_unrecognized',
    );
  });

  it('正常 JD 頁不可被誤判為限制頁', () => {
    expect(classify104Navigation({ ...job, status: 200, expectedPageShape: true })).toBeNull();
  });
});

describe('平台原始碼安全不變式', () => {
  it('JD 403 必須被明確分類為全流程停止條件', () => {
    expect(platformSource).toContain('status === 403');
    expect(platformSource).toContain('Stop the complete pipeline');
  });

  it('JD 403 不得被降級為可略過職缺', () => {
    expect(platformSource).not.toContain("stage === 'job' && status === 403 && diagnostic");
  });

  it('104 必須採用防偵測 Persistent Context 啟動機制', () => {
    expect(baseSource).toContain('launchStealthPersistentContext');
  });

  it('必須維護 persistentContext 並提供存取方法', () => {
    expect(baseSource).toContain('protected persistentContext');
    expect(baseSource).toContain('getPersistentContext()');
  });

  it('應徵流程必須使用 humanType 進行擬真人手輸入', () => {
    expect(platformSource).toContain('humanType');
  });

  it('應徵頁面必須由 Persistent Context 產出', () => {
    expect(baseSource).toContain('await this.getPersistentContext()');
  });

  it('搜尋與詳情頁面必須由 Unauthenticated Context 產出', () => {
    expect(baseSource).toContain('await this.getUnauthenticatedContext()');
  });
});
