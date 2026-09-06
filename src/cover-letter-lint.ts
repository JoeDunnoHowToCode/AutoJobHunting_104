import { countCjkChars } from './text-utils';

/**
 * Diagnostic-only quality check on a generated cover letter.
 *
 * It deliberately never returns modified text. The rules in ai/prompts.ts are
 * instructions to a model, not guarantees; this measures how often they are
 * actually followed so the decision to auto-regenerate can be made on data
 * rather than on a guess (決議 #12).
 */

/**
 * Mirrors BOTH negative-vocabulary rules in ai/prompts.ts — the 嚴禁詞彙 list and
 * the 嚴禁空泛寒暄 list. Auditing only the first one is how `您好，在 104 看到`
 * stayed missing while being the only banned phrase with real traffic.
 */
export const BANNED_PHRASES: string[] = [
  '扎實',
  '顯著提升',
  '賦能',
  '快節奏',
  '竭誠',
  '深耕',
  '致力於',
  '全面',
  '不遺餘力',
  '高度契合',
  '在當今',
  '期盼能運用',
  '貴公司享有盛名',
  '希望能給我一個機會',
  '您好，在 104 看到',
];

export type CoverLetterFlag = 'too_short' | 'too_long' | 'banned_phrase';

export interface CoverLetterLintResult {
  clean: boolean;
  cjkChars: number;
  bannedPhrases: string[];
  flags: CoverLetterFlag[];
}

export interface CoverLetterLintOptions {
  minCjkChars?: number;
  maxCjkChars?: number;
}

const DEFAULT_MIN_CJK = 100;
const DEFAULT_MAX_CJK = 220;

export function lintCoverLetter(
  text: string,
  options: CoverLetterLintOptions = {},
): CoverLetterLintResult {
  const minCjkChars = options.minCjkChars ?? DEFAULT_MIN_CJK;
  const maxCjkChars = options.maxCjkChars ?? DEFAULT_MAX_CJK;

  const cjkChars = countCjkChars(text);
  const bannedPhrases = BANNED_PHRASES.filter(phrase => text.includes(phrase));
  const flags: CoverLetterFlag[] = [];

  if (cjkChars < minCjkChars) flags.push('too_short');
  if (cjkChars > maxCjkChars) flags.push('too_long');
  if (bannedPhrases.length > 0) flags.push('banned_phrase');

  return {
    clean: flags.length === 0,
    cjkChars,
    bannedPhrases,
    flags,
  };
}
