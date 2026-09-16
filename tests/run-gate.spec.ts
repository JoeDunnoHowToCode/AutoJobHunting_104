import { describe, expect, it } from 'vitest';
import { decideRunGate } from '../src/run-gate';

describe('decideRunGate — Session 有效', () => {
  const gate = decideRunGate({ loginOk: true, platformName: '104' });

  it('允許執行', () => {
    expect(gate.shouldRun).toBe(true);
  });

  it('exitCode 為 0', () => {
    expect(gate.exitCode).toBe(0);
  });

  it('不產生告警訊息', () => {
    expect(gate.notice).toBeUndefined();
  });
});

describe('decideRunGate — Session 失效', () => {
  const gate = decideRunGate({ loginOk: false, platformName: '104' });

  // 現行 index.ts:322 throw 之後被 index.ts:385 的 catch 吞掉，
  // main() 正常 return，process.exitCode 維持 0。
  // 在無人監看的 VM 上等於：開機、跑了、什麼都沒投、乾淨關機、exit 0。
  it('必須阻止執行', () => {
    expect(gate.shouldRun).toBe(false);
  });

  it('exitCode 必須為 1，讓外部監控看得出失敗', () => {
    expect(gate.exitCode).toBe(1);
  });

  it('必須產生告警訊息', () => {
    expect(gate.notice).toBeTruthy();
  });

  it('告警必須指出是 Session 問題', () => {
    expect(gate.notice).toMatch(/Session/i);
  });

  it('告警必須給出 VNC 這個具體修復動作（決議 #7）', () => {
    expect(gate.notice).toContain('VNC');
  });

  it('告警必須指名平台', () => {
    expect(gate.notice).toContain('104');
  });

  it('告警不得含未轉義的 HTML 特殊字元', () => {
    expect(gate.notice).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });
});
