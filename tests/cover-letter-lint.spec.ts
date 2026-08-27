import { describe, expect, it } from 'vitest';
import { BANNED_PHRASES, lintCoverLetter } from '../src/cover-letter-lint';

const clean =
  '應徵自動化工程師。貴團隊需要的流程自動化，正是我過去以 Python 最常解決的問題類型。' +
  '我獨立設計過五條 RPA 流程，從需求訪談做到上線維運。遇到穩定性問題，直接寫斷點續跑機制解掉，每日釋放六人時。' +
  '系統穩健是第一考量。習慣在開發中導入 AI 輔助提速，期待把這套經驗帶進團隊。';

describe('lintCoverLetter — 禁用詞', () => {
  it('命中單一禁用詞時列出該詞', () => {
    const result = lintCoverLetter(`我有扎實的開發經驗。${clean}`);
    expect(result.bannedPhrases).toContain('扎實');
  });

  it('命中多個禁用詞時全部列出，不只第一個', () => {
    const result = lintCoverLetter(`我致力於賦能團隊，具備扎實基礎。${clean}`);
    expect(result.bannedPhrases).toEqual(
      expect.arrayContaining(['致力於', '賦能', '扎實']),
    );
  });

  it('同一個詞出現多次只列一次', () => {
    const result = lintCoverLetter(`扎實又扎實，非常扎實。${clean}`);
    expect(result.bannedPhrases.filter(p => p === '扎實')).toHaveLength(1);
  });

  it('乾淨文本回空陣列', () => {
    expect(lintCoverLetter(clean).bannedPhrases).toEqual([]);
  });

  it('禁用詞表與 prompt 的負面詞彙表一致，至少涵蓋這幾個', () => {
    expect(BANNED_PHRASES).toEqual(
      expect.arrayContaining(['扎實', '顯著提升', '賦能', '深耕', '致力於', '高度契合']),
    );
  });
});

describe('lintCoverLetter — 長度', () => {
  it('CJK 字數低於下限時標記 too_short', () => {
    expect(lintCoverLetter('太短了。').flags).toContain('too_short');
  });

  it('正常長度不標記 too_short', () => {
    expect(lintCoverLetter(clean).flags).not.toContain('too_short');
  });

  it('超過上限時標記 too_long', () => {
    const long = clean.repeat(3);
    expect(lintCoverLetter(long, { maxCjkChars: 220 }).flags).toContain('too_long');
  });

  it('恰好等於上限時不標記 too_long', () => {
    const text = '一二三四五。'.repeat(2); // 10 CJK
    expect(lintCoverLetter(text, { minCjkChars: 1, maxCjkChars: 10 }).flags).not.toContain(
      'too_long',
    );
  });

  it('回報實際 CJK 字數供統計', () => {
    expect(lintCoverLetter('一二三四五。').cjkChars).toBe(5);
  });
});

describe('lintCoverLetter — 只診斷，不改寫（決議 #12）', () => {
  it('回傳物件不含任何修改後文字欄位', () => {
    const result = lintCoverLetter(`扎實的經驗。${clean}`);
    expect(result).not.toHaveProperty('text');
    expect(result).not.toHaveProperty('cleaned');
    expect(result).not.toHaveProperty('coverLetter');
  });

  it('有問題時 clean 為 false，無問題時為 true', () => {
    expect(lintCoverLetter(`扎實。${clean}`).clean).toBe(false);
    expect(lintCoverLetter(clean).clean).toBe(true);
  });

  it('空字串視為 too_short 而非崩潰', () => {
    expect(lintCoverLetter('').flags).toContain('too_short');
  });
});
