import { describe, expect, it } from 'vitest';
import { matchAppliedButtonState } from '../src/platforms/applied-state';

// 實地驗證（2026-08-29 / 08-30）：104 至少有三種已應徵字樣，
// 隨投遞距今時間變化——當日「今日已應徵」、數十日內「近日已應徵」；
// 未投遞的職缺按鈕則單純是「應徵」。
// 三者都不在舊的 ALREADY_APPLIED_TEXT_MARKERS 列舉裡，這解釋了為什麼
// 1,680 筆生產紀錄中那道防線一次都沒觸發，也證明列舉法在這裡行不通。
describe('matchAppliedButtonState — 判定為已應徵', () => {
  it.each([
    ['今日已應徵', '當日投遞（E-4 實測，投遞後立即重查）'],
    ['近日已應徵', '數十日內（B0-2 實測，投遞後 10~30 天）'],
  ])('實地驗證樣本 %s：%s', (text, _era) => {
    expect(matchAppliedButtonState(text)).toBe(true);
  });

  it.each([
    '近期已應徵',
    '近日已應徵',
    '今日已應徵',
    '您已應徵此職缺',
    '已應徵此職缺',
    '您已投遞此職缺',
    '已投遞',
    '已送出應徵',
    '近期　已應徵', // 全形空白
    '  近期已應徵  ', // 前後空白
    '近期已應徵\n查看應徵紀錄', // 按鈕內含換行與附加文字
  ])('%s → true', text => {
    expect(matchAppliedButtonState(text)).toBe(true);
  });
});

describe('matchAppliedButtonState — 不可誤判', () => {
  // 這是關鍵陷阱：現行的 CSS 選擇器（.apply-button 等）會找到按鈕元素本身，
  // 不管它顯示什麼字。若比對把「我要應徵」也當成已應徵，正常職缺會全部投不出去。
  it.each([
    ['我要應徵', '正常可投遞狀態'],
    ['應徵', '實地驗證：未投遞職缺的真實按鈕字樣'],
    ['尚未應徵', '否定語'],
    ['未應徵', '否定語'],
    ['應徵已額滿', '「已」後面不是應徵/投遞'],
    ['立即應徵', '行動呼籲'],
    ['儲存職缺', '無關按鈕'],
    ['', '空字串'],
  ])('%s → false（%s）', (text, _why) => {
    expect(matchAppliedButtonState(text)).toBe(false);
  });

  it.each([undefined, null])('%s → false', value => {
    expect(matchAppliedButtonState(value as unknown as string)).toBe(false);
  });
});
