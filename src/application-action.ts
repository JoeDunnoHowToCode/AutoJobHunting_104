import {
  ApplicationPreflightOptions,
  ApplicationPreflightResult,
  JobPlatform,
} from './platforms/base';

export type RunMode = 'live' | 'dry-run';

export interface PipelineLimits {
  jdConcurrency: number;
  aiConcurrency: number;
  maxApplyQueueSize: number;
  resumeApplyQueueSize: number;
  maxInFlightJobs: number;
}

/** A dry-run is a single, serial observation rather than a batch process. */
export const DRY_RUN_PIPELINE_LIMITS: Readonly<PipelineLimits> = {
  jdConcurrency: 1,
  aiConcurrency: 1,
  maxApplyQueueSize: 1,
  resumeApplyQueueSize: 0,
  maxInFlightJobs: 1,
};

export function getRuntimePipelineLimits(
  mode: RunMode,
  liveLimits: Readonly<PipelineLimits>,
  applyLimit?: number,
): Readonly<PipelineLimits> {
  if (mode === 'dry-run') return DRY_RUN_PIPELINE_LIMITS;
  if (applyLimit === undefined) return liveLimits;
  return {
    ...liveLimits,
    maxApplyQueueSize: Math.min(liveLimits.maxApplyQueueSize, Math.max(1, applyLimit)),
    resumeApplyQueueSize: Math.min(liveLimits.resumeApplyQueueSize, Math.max(0, applyLimit - 1)),
    maxInFlightJobs: Math.min(liveLimits.maxInFlightJobs, Math.max(2, applyLimit * 2)),
  };
}

export type ApplicationActionResult =
  | {
      type: 'preflight';
      result: ApplicationPreflightResult;
    }
  | {
      type: 'submission';
      submitted: boolean;
    };

export interface ApplicationActionOptions {
  preflight?: ApplicationPreflightOptions;
}

/**
 * The only entry point from the pipeline into an application action.
 *
 * Keeping the mode split here is deliberate: the dry-run branch has no
 * reference to `applyToJob`, so it cannot click a final submit button through
 * a future caller mistake.
 */
export async function executeApplicationAction(
  mode: RunMode,
  platform: JobPlatform,
  jobId: string,
  coverLetter: string,
  options: ApplicationActionOptions = {},
): Promise<ApplicationActionResult> {
  if (mode === 'dry-run') {
    return {
      type: 'preflight',
      result: await platform.preflightApplication(jobId, options.preflight),
    };
  }

  return {
    type: 'submission',
    submitted: await platform.applyToJob(jobId, coverLetter),
  };
}

export function resolveRunMode(args: readonly string[] = process.argv): RunMode {
  return args.includes('--dry-run') ? 'dry-run' : 'live';
}
