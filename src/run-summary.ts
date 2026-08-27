/**
 * Builds the per-run Telegram report.
 *
 * Two properties matter more than formatting:
 *
 * 1. It is produced unconditionally. On an unattended VM, "applied 0 jobs" is
 *    itself the signal worth sending — silence is indistinguishable from a
 *    session that expired days ago.
 * 2. Every interpolated value is HTML-escaped. Telegram parses this with
 *    parse_mode=HTML, and real 104 titles contain `&`
 *    (e.g. "AI Engineer - Agents & LLMs"), which makes the API reject the
 *    message outright.
 */

export interface AppliedJobSummary {
  title: string;
  company: string;
  location: string;
  score: number;
  url: string;
}

export interface RunSummaryStats {
  mode: 'live' | 'dry-run';
  elapsedMs: number;
  processedCount: number;
  applied: AppliedJobSummary[];
  skippedCount: number;
  /** Failures that were logged but deliberately kept out of applyRecord. */
  transientCounts: Record<string, number>;
  stalled: boolean;
}

const TRANSIENT_LABELS: Record<string, string> = {
  rate_limited: 'API 額度／429',
  network: '網路或導航失敗',
  unverified: '送出後未確認',
  schema: '模型輸出格式錯誤',
  form_unavailable: '表單控制項不可用',
  truncated: '自薦信寫入不完整',
};

/** `&` must be replaced first, or later replacements get double-encoded. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDuration(elapsedMs: number): string {
  const totalMinutes = Math.round(elapsedMs / 60000);
  if (totalMinutes < 60) return `${totalMinutes} 分鐘`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours} 小時 ${totalMinutes % 60} 分鐘`;
}

export function buildRunSummary(stats: RunSummaryStats): string {
  const lines: string[] = [];
  const isDryRun = stats.mode === 'dry-run';

  lines.push(`<b>📊 ${isDryRun ? '唯讀測試 (dry-run) 報告' : '本次投遞報告'}</b>`);
  lines.push('');

  if (stats.stalled) {
    lines.push('⚠️ <b>本輪因進度停滯被 watchdog 中止</b>');
    lines.push('');
  }

  lines.push(`成功投遞 <b>${stats.applied.length}</b> 筆`);
  lines.push(`檢查 ${stats.processedCount} 筆，略過 ${stats.skippedCount} 筆`);
  lines.push(`耗時 ${formatDuration(stats.elapsedMs)}`);

  if (stats.applied.length > 0) {
    lines.push('');
    lines.push(`<b>✅ 已投遞</b>`);
    for (const job of stats.applied) {
      lines.push(
        `• <b>${escapeHtml(job.title)}</b> (${escapeHtml(job.company)})\n` +
          `  地點: ${escapeHtml(job.location)} · AI 評分: ${job.score} 分\n` +
          `  <a href="${escapeHtml(job.url)}">🔗 點此查看</a>`,
      );
    }
  }

  const transientEntries = Object.entries(stats.transientCounts).filter(([, count]) => count > 0);
  if (transientEntries.length > 0) {
    const total = transientEntries.reduce((sum, [, count]) => sum + count, 0);
    lines.push('');
    lines.push(`<b>⏳ 本輪未完成評估 (${total})</b> — 未寫入紀錄，下輪會重試`);
    for (const [kind, count] of transientEntries) {
      lines.push(`• ${escapeHtml(TRANSIENT_LABELS[kind] ?? kind)}: ${count}`);
    }
  }

  return lines.join('\n');
}
