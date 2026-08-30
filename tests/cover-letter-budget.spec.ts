import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { countCjkChars, cutAtSentenceBoundary, fitCoverLetter } from '../src/text-utils';

/**
 * Seam tests: two budgets in two different units meet here.
 *
 * `maxlength` on a textarea counts UTF-16 code units — every Latin letter,
 * digit, space and punctuation mark included. `cutAtSentenceBoundary` counts
 * CJK ideographs only, because that is the unit the prompt writes in. Feeding
 * one straight into the other trims to 206 ideographs and 387 code units, so
 * the browser silently drops 167 units and the write-back check rejects the
 * letter — every single time.
 *
 * Both functions were individually correct and individually tested. The bug
 * lived only at the join.
 */

const realLetter =
  '應徵 AI 應用工程師。貴團隊需要的 RAG 與 Agent 應用建置，正是我過去以 Python、' +
  '自動化流程與 LLM API 串接最常解決的問題類型。\n\n' +
  '我獨立設計過 5 條 RPA 流程與 AI 協作開發，從需求訪談一路做到上線維運。' +
  '面對複雜邏輯，直接用程式拆解並建立參數設定檔；同時寫出斷點續跑與錯誤捕捉機制，' +
  '每日釋放 6+ 人時。系統穩健是第一考量。\n\n' +
  '習慣在開發中導入 AI 輔助加速決策。期待能把這套自動化與 AI 實戰經驗帶進團隊，直接投入實戰。';

describe('fitCoverLetter — UTF-16 上限（textarea maxlength 的實際單位）', () => {
  it.each([500, 300, 220, 150])('maxUnits=%i 時輸出長度不得超過上限', maxUnits => {
    const fitted = fitCoverLetter(realLetter, { maxUnits });
    expect(fitted.length).toBeLessThanOrEqual(maxUnits);
  });

  it('未達上限時原文不變', () => {
    expect(fitCoverLetter('短信。', { maxUnits: 500 })).toBe('短信。');
  });

  it('英數與空白也計入 UTF-16 上限', () => {
    const latin = 'Python OpenCV Docker Kubernetes TypeScript PostgreSQL'.repeat(3);
    expect(fitCoverLetter(latin, { maxUnits: 40 }).length).toBeLessThanOrEqual(40);
  });
});

describe('fitCoverLetter — CJK 上限（prompt 的風格預算）', () => {
  it.each([220, 200, 160])('maxCjkChars=%i 時中文字數不得超過上限', maxCjkChars => {
    expect(countCjkChars(fitCoverLetter(realLetter, { maxCjkChars }))).toBeLessThanOrEqual(maxCjkChars);
  });
});

describe('fitCoverLetter — 兩個上限同時成立', () => {
  it('兩者都給時，兩個上限都必須被滿足', () => {
    const fitted = fitCoverLetter(realLetter, { maxUnits: 300, maxCjkChars: 220 });
    expect(fitted.length).toBeLessThanOrEqual(300);
    expect(countCjkChars(fitted)).toBeLessThanOrEqual(220);
  });

  it('以較嚴格的那個為準（UTF-16 較緊時）', () => {
    const strictUnits = fitCoverLetter(realLetter, { maxUnits: 120, maxCjkChars: 220 });
    expect(strictUnits.length).toBeLessThanOrEqual(120);
  });

  it('以較嚴格的那個為準（CJK 較緊時）', () => {
    const strictCjk = fitCoverLetter(realLetter, { maxUnits: 5000, maxCjkChars: 40 });
    expect(countCjkChars(strictCjk)).toBeLessThanOrEqual(40);
  });

  it('兩個都沒給時原文不變', () => {
    expect(fitCoverLetter(realLetter, {})).toBe(realLetter);
  });
});

describe('fitCoverLetter — 仍在句末邊界切', () => {
  it('切在句末標點上', () => {
    const fitted = fitCoverLetter(realLetter, { maxUnits: 200 });
    expect(fitted).toMatch(/[。！？]$/);
  });

  it('無句末標點時硬切且不超出上限', () => {
    const noPunctuation = '一二三四五六七八九十'.repeat(10);
    const fitted = fitCoverLetter(noPunctuation, { maxUnits: 30 });
    expect(fitted.length).toBeLessThanOrEqual(30);
  });

  it('空輸入回空字串', () => {
    expect(fitCoverLetter('', { maxUnits: 100 })).toBe('');
  });

  it('上限為 0 回空字串', () => {
    expect(fitCoverLetter(realLetter, { maxUnits: 0 })).toBe('');
  });
});

describe('cutAtSentenceBoundary 維持原有 CJK 語意（既有呼叫端不受影響）', () => {
  it('仍以 CJK 字數為單位', () => {
    expect(countCjkChars(cutAtSentenceBoundary(realLetter, 100))).toBeLessThanOrEqual(100);
  });
});

// 對照真實 378 封已投遞自薦信，確認任何一個可能的 maxlength 都不會再讓
// 回讀比對失敗——這正是 P0-2 在正式環境會炸的那一步。
// applyRecord.json is personal data and gitignored, so it is absent on a fresh
// clone, in CI and on the VM. Reading it at module scope made the whole file
// fail to collect there — `Test Files 1 failed / Tests no tests` — so load it
// defensively and skip the corpus regression when it is not available.
function loadRealCoverLetters(): string[] {
  const corpusPath = path.resolve(__dirname, '..', 'applyRecord.json');
  if (!fs.existsSync(corpusPath)) return [];
  const letters: string[] = [];
  const raw = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  for (const date of Object.keys(raw)) {
    for (const record of raw[date].applied ?? []) {
      if (record.coverLetter) letters.push(record.coverLetter);
    }
  }
  return letters;
}

const realLetters = loadRealCoverLetters();

describe.skipIf(realLetters.length === 0)('fitCoverLetter — 真實自薦信全量回歸', () => {
  it('樣本讀取成功', () => {
    expect(realLetters.length).toBeGreaterThan(300);
  });

  it.each([200, 250, 300, 500, 1000])(
    'maxUnits=%i：378 封全部裁切後皆不超過上限',
    maxUnits => {
      const violations = realLetters.filter(letter => fitCoverLetter(letter, { maxUnits }).length > maxUnits);
      expect(violations).toHaveLength(0);
    },
  );

  // 只斷言上界會漏掉「切太多」：一封本來就符合預算的信被切回最後一個句號，
  // 長度仍然合格，回寫比對也拿裁切後的版本去比，所以殘缺的信會直接送出。
  it('已符合預算的信件必須原樣返回，不得多切', () => {
    const mutilated = realLetters.filter(
      letter => letter.length <= 1000 && fitCoverLetter(letter, { maxUnits: 1000 }) !== letter,
    );
    expect(mutilated).toHaveLength(0);
  });
});
