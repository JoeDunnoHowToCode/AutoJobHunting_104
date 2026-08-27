/**
 * Interface skeleton only — the classification logic is deliberately absent so
 * the spec fails on assertions rather than on a missing module.
 */

export type FailureKind = 'permanent' | 'transient';

export class UnverifiedSubmissionError extends Error {
  public readonly buttonText?: string;

  constructor(message: string, buttonText?: string) {
    super(message);
    this.name = 'UnverifiedSubmissionError';
    this.buttonText = buttonText;
  }
}

export function classifyFailure(_error: unknown): FailureKind {
  return 'permanent';
}
