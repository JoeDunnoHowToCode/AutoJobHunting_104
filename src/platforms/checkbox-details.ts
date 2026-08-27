/** Interface skeleton only — no collection logic yet. */

export interface CheckboxDetail {
  name: string;
  label: string;
  checked: boolean;
  required: boolean;
}

export function collectCheckboxDetails(_doc: Document): CheckboxDetail[] {
  return [];
}
