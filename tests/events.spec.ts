import { describe, expect, it } from 'vitest';
import { formatEvent } from '../src/events';

describe('formatEvent', () => {
  it('以 [EVENT] 前綴開頭，供 Cloud Logging 篩選', () => {
    expect(formatEvent('run_start', {})).toMatch(/^\[EVENT\] /);
  });

  it('含事件名稱', () => {
    expect(formatEvent('apply_success', {})).toContain('event=apply_success');
  });

  it('以 key=value 輸出欄位', () => {
    const line = formatEvent('apply_success', { jobId: 'abc12', score: 88 });
    expect(line).toContain('jobId=abc12');
    expect(line).toContain('score=88');
  });

  it('含空白的值加上引號，避免欄位被切開', () => {
    expect(formatEvent('apply_fail', { reason: 'form unavailable' })).toContain(
      'reason="form unavailable"',
    );
  });

  it('值裡的引號被轉義', () => {
    expect(formatEvent('apply_fail', { button: '近期已應徵"x"' })).toContain(
      'button="近期已應徵\\"x\\""',
    );
  });

  it('換行被替換，保持單行可解析', () => {
    const line = formatEvent('apply_fail', { reason: 'line one\nline two' });
    expect(line).not.toContain('\n');
  });

  it('undefined 與 null 欄位被略過', () => {
    const line = formatEvent('jd_skip', { jobId: 'a', location: undefined, score: null });
    expect(line).toContain('jobId=a');
    expect(line).not.toContain('location');
    expect(line).not.toContain('score');
  });

  it('布林值原樣輸出', () => {
    expect(formatEvent('run_end', { stalled: false })).toContain('stalled=false');
  });

  it('無欄位時仍是合法單行', () => {
    expect(formatEvent('run_start', {})).toBe('[EVENT] event=run_start');
  });
});
