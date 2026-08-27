/**
 * Maps an AI suitability score to a p-queue priority.
 *
 * The apply queue stays strictly serial, so priority only decides *order*, not
 * concurrency. It matters when a run hits its apply limit: whatever is still
 * queued gets dropped, and the survivors should be the best-scoring jobs rather
 * than whichever finished evaluation first.
 */
export function applyPriorityForScore(score: number): number {
  // p-queue runs higher priority first. Scores are 0-100 already, so they map
  // directly; clamping keeps a malformed score from jumping the queue.
  return Math.max(0, Math.min(100, Math.round(score)));
}
