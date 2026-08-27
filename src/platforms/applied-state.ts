/**
 * Reads 104's own apply-button state instead of guessing from a success toast.
 *
 * The button text is a persistent state indicator: once a job has been applied
 * to, 104 relabels it ("近期已應徵" / "近日已應徵") and clicking it raises a
 * confirm-again dialog. That makes it a far better source of truth than the
 * 15-second success-text race that produced 20 unverifiable records.
 *
 * Matching is deliberately loose on the prefix and strict on the verb. The old
 * approach enumerated three exact strings and never once matched in production.
 */

/** `已` immediately followed by an application verb, ignoring any whitespace. */
const APPLIED_STATE_PATTERN = /已\s*(應徵|投遞|送出應徵)/;

/** Guards against "尚未應徵" / "未應徵" being read as a positive. */
const NEGATED_PATTERN = /[尚未]\s*應徵/;

export function matchAppliedButtonState(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text.replace(/[\s　]+/g, '');
  if (NEGATED_PATTERN.test(normalized)) return false;
  return APPLIED_STATE_PATTERN.test(normalized);
}
