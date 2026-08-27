/** Interface skeleton only — no formatting logic yet. */

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
  transientCounts: Record<string, number>;
  stalled: boolean;
}

export function escapeHtml(_value: string): string {
  return '';
}

export function buildRunSummary(_stats: RunSummaryStats): string {
  return '';
}
