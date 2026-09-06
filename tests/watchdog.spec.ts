import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressWatchdog } from '../src/watchdog';

const STALL_MS = 15 * 60 * 1000;

describe('ProgressWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('從未 start() 就不會觸發', () => {
    const onStall = vi.fn();
    new ProgressWatchdog({ stallMs: STALL_MS, onStall });

    vi.advanceTimersByTime(STALL_MS * 3);

    expect(onStall).not.toHaveBeenCalled();
  });

  it('超過停滯門檻後觸發一次', () => {
    const onStall = vi.fn();
    const watchdog = new ProgressWatchdog({ stallMs: STALL_MS, onStall });
    watchdog.start();

    vi.advanceTimersByTime(STALL_MS + 60_000);

    expect(onStall).toHaveBeenCalledTimes(1);
    watchdog.stop();
  });

  it('門檻內尚未觸發', () => {
    const onStall = vi.fn();
    const watchdog = new ProgressWatchdog({ stallMs: STALL_MS, onStall });
    watchdog.start();

    vi.advanceTimersByTime(STALL_MS - 1000);

    expect(onStall).not.toHaveBeenCalled();
    watchdog.stop();
  });

  it('tick() 重置計時，之後才會重新累積', () => {
    const onStall = vi.fn();
    const watchdog = new ProgressWatchdog({ stallMs: STALL_MS, onStall });
    watchdog.start();

    vi.advanceTimersByTime(14 * 60 * 1000);
    watchdog.tick();
    vi.advanceTimersByTime(14 * 60 * 1000);
    expect(onStall).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(onStall).toHaveBeenCalledTimes(1);

    watchdog.stop();
  });

  it('只觸發一次，不重複告警', () => {
    const onStall = vi.fn();
    const watchdog = new ProgressWatchdog({ stallMs: STALL_MS, onStall });
    watchdog.start();

    vi.advanceTimersByTime(STALL_MS * 5);

    expect(onStall).toHaveBeenCalledTimes(1);
    watchdog.stop();
  });

  it('stop() 之後不再觸發', () => {
    const onStall = vi.fn();
    const watchdog = new ProgressWatchdog({ stallMs: STALL_MS, onStall });
    watchdog.start();
    watchdog.stop();

    vi.advanceTimersByTime(STALL_MS * 3);

    expect(onStall).not.toHaveBeenCalled();
  });

  it('觸發後 stalled 為 true，供摘要標示', () => {
    const watchdog = new ProgressWatchdog({ stallMs: STALL_MS, onStall: () => {} });
    watchdog.start();
    expect(watchdog.stalled).toBe(false);

    vi.advanceTimersByTime(STALL_MS + 60_000);

    expect(watchdog.stalled).toBe(true);
    watchdog.stop();
  });
});
