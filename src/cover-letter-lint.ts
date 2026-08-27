/** Interface skeleton only — no lint logic yet. */

export const BANNED_PHRASES: string[] = [];

export interface CoverLetterLintResult {
  clean: boolean;
  cjkChars: number;
  bannedPhrases: string[];
  flags: string[];
}

export interface CoverLetterLintOptions {
  minCjkChars?: number;
  maxCjkChars?: number;
}

export function lintCoverLetter(
  _text: string,
  _options: CoverLetterLintOptions = {},
): CoverLetterLintResult {
  return { clean: true, cjkChars: 0, bannedPhrases: [], flags: [] };
}
