// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectCheckboxDetails } from '../src/platforms/checkbox-details';

function render(html: string): void {
  document.body.innerHTML = html;
}

describe('collectCheckboxDetails — label 來源', () => {
  it('以 for 屬性關聯的 label', () => {
    render('<label for="agree">我同意個資使用條款</label><input id="agree" type="checkbox">');
    expect(collectCheckboxDetails(document)[0].label).toBe('我同意個資使用條款');
  });

  it('包裹式 label', () => {
    render('<label><input type="checkbox">訂閱職缺電子報</label>');
    expect(collectCheckboxDetails(document)[0].label).toBe('訂閱職缺電子報');
  });

  it('aria-label', () => {
    render('<input type="checkbox" aria-label="開放企業查看履歷">');
    expect(collectCheckboxDetails(document)[0].label).toBe('開放企業查看履歷');
  });

  it('for 屬性優先於 aria-label', () => {
    render('<label for="c">來自 label</label><input id="c" type="checkbox" aria-label="來自 aria">');
    expect(collectCheckboxDetails(document)[0].label).toBe('來自 label');
  });

  it('完全無 label 時回空字串而非 undefined', () => {
    render('<input type="checkbox">');
    expect(collectCheckboxDetails(document)[0].label).toBe('');
  });

  it('label 文字前後空白被修掉', () => {
    render('<label for="c">   我同意   </label><input id="c" type="checkbox">');
    expect(collectCheckboxDetails(document)[0].label).toBe('我同意');
  });
});

describe('collectCheckboxDetails — 狀態欄位', () => {
  it('回報勾選狀態', () => {
    render('<input type="checkbox" checked><input type="checkbox">');
    const details = collectCheckboxDetails(document);
    expect(details.map(d => d.checked)).toEqual([true, false]);
  });

  it('回報 required', () => {
    render('<input type="checkbox" required><input type="checkbox">');
    const details = collectCheckboxDetails(document);
    expect(details.map(d => d.required)).toEqual([true, false]);
  });

  it('回報 name 供辨識', () => {
    render('<input type="checkbox" name="privacyAgree">');
    expect(collectCheckboxDetails(document)[0].name).toBe('privacyAgree');
  });
});

describe('collectCheckboxDetails — 範圍', () => {
  it('display:none 的 checkbox 不列入', () => {
    render('<input type="checkbox" style="display:none"><input type="checkbox">');
    expect(collectCheckboxDetails(document)).toHaveLength(1);
  });

  it('hidden 屬性的 checkbox 不列入', () => {
    render('<input type="checkbox" hidden><input type="checkbox">');
    expect(collectCheckboxDetails(document)).toHaveLength(1);
  });

  it('非 checkbox 的 input 不列入', () => {
    render('<input type="text"><input type="radio"><input type="checkbox">');
    expect(collectCheckboxDetails(document)).toHaveLength(1);
  });

  it('沒有任何 checkbox 時回空陣列', () => {
    render('<div>沒有表單</div>');
    expect(collectCheckboxDetails(document)).toEqual([]);
  });

  it('多個 checkbox 依文件順序回傳', () => {
    render(
      '<label for="a">第一</label><input id="a" type="checkbox">' +
        '<label for="b">第二</label><input id="b" type="checkbox">',
    );
    expect(collectCheckboxDetails(document).map(d => d.label)).toEqual(['第一', '第二']);
  });
});

// 決議 #14：第一步只做診斷，行為完全不變。分類規則等看過真實 label 再手寫。
describe('collectCheckboxDetails — 純診斷，不得改動 DOM', () => {
  it('不改變任何 checkbox 的勾選狀態', () => {
    render('<input type="checkbox" id="x"><input type="checkbox" id="y" checked>');
    collectCheckboxDetails(document);
    expect((document.getElementById('x') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('y') as HTMLInputElement).checked).toBe(true);
  });

  it('回傳結構不含任何分類判斷欄位', () => {
    render('<label for="c">我同意條款</label><input id="c" type="checkbox">');
    const detail = collectCheckboxDetails(document)[0];
    expect(detail).not.toHaveProperty('category');
    expect(detail).not.toHaveProperty('isConsent');
    expect(detail).not.toHaveProperty('shouldCheck');
  });
});
