import { describe, expect, it } from 'vitest';
import { buildRunSummary, escapeHtml, RunSummaryStats } from '../src/run-summary';

function stats(overrides: Partial<RunSummaryStats> = {}): RunSummaryStats {
  return {
    mode: 'live',
    elapsedMs: 42 * 60 * 1000,
    processedCount: 0,
    applied: [],
    skippedCount: 0,
    transientCounts: {},
    stalled: false,
    ...overrides,
  };
}

function applied(title: string, company = '測試公司') {
  return {
    title,
    company,
    location: '台北市',
    score: 88,
    url: 'https://www.104.com.tw/job/abc12',
  };
}

describe('buildRunSummary — 零投遞必須主動可見', () => {
  // 這是 exit-0 靜默失敗的解藥。現行 index.ts:408 的條件是
  // 「有 applied 或 failed 才發」，所以「今天投了 0 筆」在 VM 上完全無聲。
  it('0 投遞 0 失敗仍產出非空摘要', () => {
    expect(buildRunSummary(stats())).not.toBe('');
  });

  it('明確寫出投遞 0 筆', () => {
    expect(buildRunSummary(stats())).toMatch(/投遞\D*0/);
  });
});

describe('buildRunSummary — 內容完整性', () => {
  it('含本輪耗時', () => {
    expect(buildRunSummary(stats({ elapsedMs: 42 * 60 * 1000 }))).toContain('42');
  });

  it('含處理筆數與略過筆數', () => {
    const summary = buildRunSummary(stats({ processedCount: 137, skippedCount: 120 }));
    expect(summary).toContain('137');
    expect(summary).toContain('120');
  });

  it('列出成功投遞的職缺與分數', () => {
    const summary = buildRunSummary(stats({ applied: [applied('AI 工程師')] }));
    expect(summary).toContain('AI 工程師');
    expect(summary).toContain('88');
  });

  it('分類列出 transient 失敗統計', () => {
    const summary = buildRunSummary(
      stats({ transientCounts: { rate_limited: 17, network: 2, unverified: 1 } }),
    );
    expect(summary).toContain('17');
    expect(summary).toContain('2');
    expect(summary).toContain('1');
  });

  it('transient 全為零時不顯示空的失敗區塊', () => {
    expect(buildRunSummary(stats({ transientCounts: {} }))).not.toContain('本輪未完成評估');
  });

  it('watchdog 觸發時摘要必須標示', () => {
    expect(buildRunSummary(stats({ stalled: true }))).toMatch(/停滯|watchdog/i);
  });

  it('dry-run 模式標示為唯讀', () => {
    expect(buildRunSummary(stats({ mode: 'dry-run' }))).toMatch(/唯讀|dry-run/i);
  });
});

describe('escapeHtml — Telegram parse_mode=HTML 安全性', () => {
  // 實測：applyRecord.json 裡已有 12 筆標題含 &，例如
  // 「AI Engineer - Agents & LLMs」與「【2026-104職涯博覽會-150&151攤】」。
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
  ])('%s 轉為 %s', (raw, encoded) => {
    expect(escapeHtml(raw)).toBe(encoded);
  });

  it('& 必須先轉，避免二次轉義產生 &amp;lt;', () => {
    expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;');
  });

  it('一般文字不受影響', () => {
    expect(escapeHtml('AI 工程師')).toBe('AI 工程師');
  });
});

describe('buildRunSummary — 職缺標題轉義', () => {
  it('標題含 & 時輸出已轉義，不留裸 &', () => {
    const summary = buildRunSummary(stats({ applied: [applied('AI Engineer - Agents & LLMs')] }));
    expect(summary).toContain('Agents &amp; LLMs');
    expect(summary).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });

  it('公司名含尖括號時輸出已轉義', () => {
    const summary = buildRunSummary(stats({ applied: [applied('工程師', '<script>公司')] }));
    expect(summary).toContain('&lt;script&gt;公司');
    expect(summary).not.toContain('<script>');
  });
});
