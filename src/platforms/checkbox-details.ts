/**
 * Reads what the application form's checkboxes actually say.
 *
 * Purely diagnostic. The live path still refuses to submit when anything is
 * unchecked — deciding which consents may be ignored is not a call automation
 * should make, and not a call to make before seeing real labels (決議 #14).
 *
 * Written against plain DOM APIs so it can be injected with `page.evaluate()`
 * and still be tested under jsdom.
 */

export interface CheckboxDetail {
  name: string;
  label: string;
  checked: boolean;
  required: boolean;
}

function labelFor(input: HTMLInputElement, doc: Document): string {
  if (input.id) {
    const associated = doc.querySelector(`label[for="${input.id}"]`);
    const text = associated?.textContent?.trim();
    if (text) return text;
  }

  const wrapping = input.closest('label');
  const wrappingText = wrapping?.textContent?.trim();
  if (wrappingText) return wrappingText;

  return input.getAttribute('aria-label')?.trim() ?? '';
}

function isVisible(input: HTMLInputElement): boolean {
  if (input.hidden) return false;
  // jsdom has no layout engine, so offsetParent is useless here. Inline and
  // computed styles are what both jsdom and a real browser agree on.
  const style = input.ownerDocument.defaultView?.getComputedStyle(input);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return true;
}

export function collectCheckboxDetails(doc: Document): CheckboxDetail[] {
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

  return inputs.filter(isVisible).map(input => ({
    name: input.name || '',
    label: labelFor(input, doc),
    checked: input.checked,
    required: input.required,
  }));
}
