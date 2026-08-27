/**
 * Reads what the application form's checkboxes actually say.
 *
 * Purely diagnostic. The live path still refuses to submit when anything is
 * unchecked — deciding which consents may be ignored is not a call automation
 * should make, and not a call to make before seeing real labels (決議 #14).
 *
 * This function is handed to `page.evaluate()`, which serialises it and runs it
 * inside the browser. It therefore must be entirely self-contained: no imports,
 * no module-scope helpers. Keeping it on plain DOM APIs is what also lets it be
 * tested directly under jsdom.
 */

export interface CheckboxDetail {
  name: string;
  label: string;
  checked: boolean;
  required: boolean;
}

export function collectCheckboxDetails(): CheckboxDetail[] {
  // Takes no parameter: Playwright's page.evaluate(fn) calls it with no
  // arguments, and both jsdom and the browser expose `document` globally.
  const doc = document;
  const inputs = Array.from(doc.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
  const details: CheckboxDetail[] = [];

  for (const input of inputs) {
    if (input.hidden) continue;
    // jsdom has no layout engine, so offsetParent is useless here. Computed
    // style is what jsdom and a real browser both agree on.
    const style = input.ownerDocument.defaultView?.getComputedStyle(input);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;

    let label = '';
    if (input.id) {
      const associated = doc.querySelector(`label[for="${input.id}"]`);
      label = associated?.textContent?.trim() ?? '';
    }
    if (!label) {
      const wrapping = input.closest('label');
      label = wrapping?.textContent?.trim() ?? '';
    }
    if (!label) {
      label = input.getAttribute('aria-label')?.trim() ?? '';
    }

    details.push({
      name: input.name || '',
      label,
      checked: input.checked,
      required: input.required,
    });
  }

  return details;
}
