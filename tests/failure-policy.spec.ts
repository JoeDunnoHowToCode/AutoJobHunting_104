import { describe, expect, it } from 'vitest';
import { classifyFailure, UnverifiedSubmissionError } from '../src/failure-policy';
import { ApplicationFormError, PlatformAccessError } from '../src/platforms/platform104';

function accessError(code: 'SESSION_EXPIRED' | 'PLATFORM_LIMITED' | 'PAGE_UNRECOGNIZED') {
  return new PlatformAccessError(code, 'test', {
    stage: 'application',
    classification: 'http_forbidden',
    path: 'https://www.104.com.tw/job/x',
    markerIds: [],
  });
}

describe('classifyFailure — transient（不寫 DB，下輪重試）', () => {
  it('HTTP 429 速率限制', () => {
    expect(classifyFailure({ status: 429, message: 'rate limit' })).toBe('transient');
  });

  it('Gemini 風格的巢狀 429 錯誤物件', () => {
    expect(classifyFailure(new Error('{"error":{"code":429,"message":"quota exceeded"}}'))).toBe(
      'transient',
    );
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'])('網路錯誤 %s', code => {
    expect(classifyFailure({ code })).toBe('transient');
  });

  it('Playwright 導航中斷', () => {
    expect(classifyFailure(new Error('page.goto: net::ERR_ABORTED at https://x'))).toBe('transient');
  });

  it('Zod schema 驗證失敗（模型輸出不穩，重跑會好）', () => {
    expect(classifyFailure(new Error('Schema validation failed: Invalid option'))).toBe('transient');
  });

  it('表單控制項不可用（104 改版或未勾選選項，不該永久鎖）', () => {
    expect(classifyFailure(new ApplicationFormError('FORM_UNAVAILABLE', 'x'))).toBe('transient');
  });

  it('送出後無法確認結果', () => {
    expect(classifyFailure(new UnverifiedSubmissionError('按鈕狀態讀不到'))).toBe('transient');
  });

  it('未知錯誤保守歸為 transient（永久鎖代價太高）', () => {
    expect(classifyFailure(new Error('something nobody predicted'))).toBe('transient');
  });

  it('Session 失效屬可修復狀態，不該永久鎖住職缺', () => {
    expect(classifyFailure(accessError('SESSION_EXPIRED'))).toBe('transient');
  });
});

describe('classifyFailure — permanent（寫 DB）', () => {
  it('104 明示已應徵', () => {
    expect(classifyFailure(new ApplicationFormError('ALREADY_APPLIED', 'x'))).toBe('permanent');
  });

  it('職缺已關閉或不存在', () => {
    expect(classifyFailure(new ApplicationFormError('JOB_UNAVAILABLE', 'x'))).toBe('permanent');
  });
});

// classifyFailure is platform-agnostic policy. It must recognise a platform's
// form error by shape, so a second platform (CakeResume / Yourator) does not
// require this module to import it — and so no import cycle is needed.
describe('classifyFailure — 以形狀辨識平台錯誤，不依賴具體平台模組', () => {
  it.each([
    ['ALREADY_APPLIED', 'permanent'],
    ['JOB_UNAVAILABLE', 'permanent'],
    ['FORM_UNAVAILABLE', 'transient'],
  ])('形似 ApplicationFormError 且 code=%s → %s', (code, expected) => {
    expect(classifyFailure({ name: 'ApplicationFormError', code, message: 'x' })).toBe(expected);
  });

  it('形似 UnverifiedSubmissionError → transient', () => {
    expect(classifyFailure({ name: 'UnverifiedSubmissionError', message: 'x' })).toBe('transient');
  });

  it('name 相符但 code 未知時保守歸為 transient', () => {
    expect(classifyFailure({ name: 'ApplicationFormError', code: 'SOMETHING_NEW' })).toBe('transient');
  });
});

describe('UnverifiedSubmissionError', () => {
  it('攜帶讀到的按鈕原文供事後追查', () => {
    const error = new UnverifiedSubmissionError('讀不到按鈕', '我要應徵');
    expect(error.buttonText).toBe('我要應徵');
    expect(error.name).toBe('UnverifiedSubmissionError');
  });
});
