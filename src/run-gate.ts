/**
 * Decides whether a run may proceed, and what to tell the operator if not.
 *
 * Split out of main() so the decision is testable and, more importantly, so a
 * failed session can no longer exit 0. On the scheduled VM the operator has to
 * reconnect over VNC to log in again (決議 #7), which means the notice has to
 * name that action explicitly — nobody is watching the console.
 */

export interface RunGateInput {
  loginOk: boolean;
  platformName: string;
}

export interface RunGateDecision {
  shouldRun: boolean;
  exitCode: 0 | 1;
  /** Telegram-ready text. Plain, so it needs no HTML escaping downstream. */
  notice?: string;
}

export function decideRunGate(input: RunGateInput): RunGateDecision {
  if (input.loginOk) {
    return { shouldRun: true, exitCode: 0 };
  }

  return {
    shouldRun: false,
    exitCode: 1,
    notice:
      `🔑 ${input.platformName} 登入 Session 已失效，本輪未執行任何投遞。\n` +
      `請透過 VNC 連進 VM 執行 npm run login 重新登入，再等下一輪排程。`,
  };
}
