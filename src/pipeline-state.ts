import { JobDatabase } from './db';

/** Tracks one run's deduplication and application-slot reservations. */
export class PipelineState {
  private readonly inFlightJobIds = new Set<string>();
  private readonly attemptedJobIds = new Set<string>();
  private readonly reservedApplyJobIds = new Set<string>();

  public tryStart(jobId: string, database: JobDatabase): boolean {
    if (database.hasBeenProcessed(jobId) || this.inFlightJobIds.has(jobId) || this.attemptedJobIds.has(jobId)) {
      return false;
    }
    this.inFlightJobIds.add(jobId);
    this.attemptedJobIds.add(jobId);
    return true;
  }

  public canAcceptMore(maxInFlightJobs: number): boolean {
    return this.inFlightJobIds.size < maxInFlightJobs;
  }

  public reserveApply(jobId: string, appliedCount: number, applyLimit: number): boolean {
    if (appliedCount + this.reservedApplyJobIds.size >= applyLimit) {
      return false;
    }
    this.reservedApplyJobIds.add(jobId);
    return true;
  }

  public releaseApply(jobId: string): void {
    this.reservedApplyJobIds.delete(jobId);
  }

  public finish(jobId: string): void {
    this.reservedApplyJobIds.delete(jobId);
    this.inFlightJobIds.delete(jobId);
  }

  public clearPending(): void {
    this.inFlightJobIds.clear();
    this.reservedApplyJobIds.clear();
  }

  public get inFlightCount(): number {
    return this.inFlightJobIds.size;
  }

  public get reservedApplyCount(): number {
    return this.reservedApplyJobIds.size;
  }
}
