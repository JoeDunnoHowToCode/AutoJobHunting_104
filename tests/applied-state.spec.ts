import { describe, expect, it } from 'vitest';
import { matchAppliedButtonState } from '../src/platforms/applied-state';

// 實地驗證（2026-08-29，四筆已投遞職缺，投遞日 07-30 ~ 08-19）：
// 104 實際顯示的字樣是「近日已應徵」，未投遞的職缺按鈕則是「應徵」——
// 兩者都不在舊的 ALREADY_APPLIED_TEXT_MARKERS 列舉裡，這也解釋了為什麼
// 1,680 筆生產紀錄中那道防線一次都沒觸發。
describe('matchAppliedButtonState — 判定為已應徵', () => {
  it('實地驗證樣本：104 真實顯示的「近日已應徵」', () => {
    expect(matchAppliedButtonState('近日已應徵')).toBe(true);
  });

  it.each([
    '近期已應徵',
    '近日已應徵',
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
