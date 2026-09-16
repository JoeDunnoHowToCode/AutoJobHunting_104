import { describe, expect, it } from 'vitest';
import { countCjkChars, cutAtSentenceBoundary } from '../src/text-utils';

describe('countCjkChars', () => {
  it('只數中日韓字元，忽略拉丁字母與標點', () => {
    expect(countCjkChars('應徵 AI 工程師。')).toBe(5);
  });

  it('空字串為 0', () => {
    expect(countCjkChars('')).toBe(0);
  });
});

describe('cutAtSentenceBoundary — 不需裁切', () => {
  it('長度小於上限時原文不變', () => {
    const text = '系統穩健是第一考量。';
    expect(cutAtSentenceBoundary(text, 100)).toBe(text);
  });

  it('長度恰好等於上限時原文不變', () => {
    const text = '一二三四五六七八九十';
    expect(cutAtSentenceBoundary(text, 10)).toBe(text);
  });
});

describe('cutAtSentenceBoundary — 句末標點邊界', () => {
  it('以句號為邊界，保留該句號', () => {
    const text = '第一句話在這裡。第二句話比較長一點點。';
    const result = cutAtSentenceBoundary(text, 10);
    expect(result).toBe('第一句話在這裡。');
  });

  it('以驚嘆號為邊界', () => {
    expect(cutAtSentenceBoundary('上線至今零故障！後面還有很多字要被切掉。', 10)).toBe(
      '上線至今零故障！',
    );
  });

  it('以問號為邊界', () => {
    expect(cutAtSentenceBoundary('這樣可行嗎？後面還有很多字要被切掉。', 8)).toBe('這樣可行嗎？');
  });

  it('句末標點恰好落在上限位置時保留該標點', () => {
    // 「一二三四五」= 5 個 CJK，句號在第 6 個字元位置
    expect(cutAtSentenceBoundary('一二三四五。六七八九十。', 5)).toBe('一二三四五。');
  });

  it('取最後一個仍在上限內的句末標點，不是第一個', () => {
    const text = '短句。第二句也不長。第三句會超過上限所以要被切掉。';
    expect(cutAtSentenceBoundary(text, 12)).toBe('短句。第二句也不長。');
  });
});

describe('cutAtSentenceBoundary — 沒有句末標點', () => {
  it('全文無句末標點時硬切至上限', () => {
    const result = cutAtSentenceBoundary('一二三四五六七八九十十一十二', 10);
    expect(countCjkChars(result)).toBe(10);
  });

  it('上限之前無句末標點時硬切，不回頭找更早的段落', () => {
    const result = cutAtSentenceBoundary('一二三四五六七八九十。', 5);
    expect(countCjkChars(result)).toBeLessThanOrEqual(5);
  });
});

describe('cutAtSentenceBoundary — 段落與防禦', () => {
  it('多段落只切尾段，前面段落結構保留', () => {
    const text = '第一段結束。\n\n第二段開始也結束。\n\n第三段超長會被切掉所以不留。';
    const result = cutAtSentenceBoundary(text, 16);
    expect(result).toContain('\n\n');
    expect(result.endsWith('。')).toBe(true);
    expect(result).not.toContain('第三段');
  });

  it('上限為 0 時回空字串', () => {
    expect(cutAtSentenceBoundary('任何內容都不該留下。', 0)).toBe('');
  });

  it('上限為負數時回空字串', () => {
    expect(cutAtSentenceBoundary('任何內容都不該留下。', -5)).toBe('');
  });

  it('空輸入回空字串', () => {
    expect(cutAtSentenceBoundary('', 100)).toBe('');
  });

  it('裁切後不留下尾端空白', () => {
    const result = cutAtSentenceBoundary('第一句。   後面很長很長很長很長很長。', 4);
    expect(result).toBe(result.trimEnd());
  });

  it('以 CJK 字數計算，不受夾雜的英文與空白影響', () => {
    // 20 個 CJK 但總字元數遠超過 20
    const text = '我用 Python 與 OpenCV 寫了五條流程。後面這句應該要被裁掉才對。';
    const result = cutAtSentenceBoundary(text, 14);
    expect(result).toBe('我用 Python 與 OpenCV 寫了五條流程。');
  });
});
