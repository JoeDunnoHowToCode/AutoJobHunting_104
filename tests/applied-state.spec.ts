import { describe, expect, it } from 'vitest';
import { matchAppliedButtonState } from '../src/platforms/applied-state';

describe('matchAppliedButtonState — 判定為已應徵', () => {
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
    ['應徵', '純動作字樣'],
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
