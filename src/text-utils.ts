/**
 * Cover-letter length control.
 *
 * 104's textarea may carry a `maxlength`, and Playwright's pressSequentially
 * silently drops whatever exceeds it — producing a half-sentence letter that
 * still reports success. Trimming on a sentence boundary keeps the letter
 * readable; the caller then verifies what actually landed in the field.
 *
 * Length is measured in CJK characters because that is the unit the prompt and
 * the platform both think in. Latin words and whitespace are not counted.
 */

const CJK_PATTERN = /[㐀-䶿一-鿿豈-﫿]/;
const SENTENCE_ENDINGS = new Set(['。', '！', '？', '!', '?']);

export function countCjkChars(value: string): number {
  let count = 0;
  for (const char of value) {
    if (CJK_PATTERN.test(char)) count++;
  }
  return count;
}

export function cutAtSentenceBoundary(text: string, maxCjkChars: number): string {
  if (!text || maxCjkChars <= 0) return '';
  if (countCjkChars(text) <= maxCjkChars) return text;

  const characters = [...text];
  let cjkSeen = 0;
  // Index just past the last sentence ending that still fits.
  let lastBoundaryEnd = -1;
  // Index just past the last character that still fits.
  let limitEnd = characters.length;

  for (let index = 0; index < characters.length; index++) {
    const char = characters[index];
    const isCjk = CJK_PATTERN.test(char);

    if (isCjk && cjkSeen === maxCjkChars) {
      limitEnd = index;
      break;
    }
    if (isCjk) cjkSeen++;
    if (SENTENCE_ENDINGS.has(char)) lastBoundaryEnd = index + 1;
  }

  const cutEnd = lastBoundaryEnd > 0 ? lastBoundaryEnd : limitEnd;
  return characters.slice(0, cutEnd).join('').trimEnd();
}
