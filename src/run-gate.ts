/** Interface skeleton only — no decision logic yet. */

export interface RunGateInput {
  loginOk: boolean;
  platformName: string;
}

export interface RunGateDecision {
  shouldRun: boolean;
  exitCode: 0 | 1;
  notice?: string;
}

export function decideRunGate(_input: RunGateInput): RunGateDecision {
  return { shouldRun: true, exitCode: 0 };
}
