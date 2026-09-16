import { describe, expect, it } from 'vitest';
import { RateLimitCircuit } from '../src/rate-limit-circuit';

function rateLimited() {
  return { status: 429, message: 'rate limit exceeded' };
}

function nestedQuotaError() {
  return new Error('{"error":{"code":429,"message":"You exceeded your current quota"}}');
}

describe('RateLimitCircuit', () => {
  it('初始狀態不該停', () => {
    expect(new RateLimitCircuit({ threshold: 5 }).shouldStop).toBe(false);
  });

  it('連續 4 次 429 尚未達門檻', () => {
    const circuit = new RateLimitCircuit({ threshold: 5 });
    for (let i = 0; i < 4; i++) circuit.recordFailure(rateLimited());
    expect(circuit.shouldStop).toBe(false);
  });

  it('連續 5 次 429 觸發熔斷', () => {
    const circuit = new RateLimitCircuit({ threshold: 5 });
    for (let i = 0; i < 5; i++) circuit.recordFailure(rateLimited());
    expect(circuit.shouldStop).toBe(true);
  });

  it('辨識巢狀 JSON 裡的 429', () => {
    const circuit = new RateLimitCircuit({ threshold: 2 });
    circuit.recordFailure(nestedQuotaError());
    circuit.recordFailure(nestedQuotaError());
    expect(circuit.shouldStop).toBe(true);
  });

  it('一次成功即歸零，重新累積', () => {
    const circuit = new RateLimitCircuit({ threshold: 5 });
    for (let i = 0; i < 3; i++) circuit.recordFailure(rateLimited());
    circuit.recordSuccess();
    for (let i = 0; i < 4; i++) circuit.recordFailure(rateLimited());
    expect(circuit.shouldStop).toBe(false);
  });

  it('非 429 錯誤不計入', () => {
    const circuit = new RateLimitCircuit({ threshold: 2 });
    circuit.recordFailure(new Error('Schema validation failed'));
    circuit.recordFailure(new Error('net::ERR_ABORTED'));
    circuit.recordFailure(new Error('something else'));
    expect(circuit.shouldStop).toBe(false);
  });

  it('非 429 錯誤也不會重置 429 計數', () => {
    const circuit = new RateLimitCircuit({ threshold: 2 });
    circuit.recordFailure(rateLimited());
    circuit.recordFailure(new Error('Schema validation failed'));
    circuit.recordFailure(rateLimited());
    expect(circuit.shouldStop).toBe(true);
  });

  // 免費層耗盡的是每日總量，不是瞬時尖峰。退避重試救不回來，
  // 只會讓每個職缺各燒 36 秒後被標記失敗。
  it('觸發後保持觸發，不自動復原', () => {
    const circuit = new RateLimitCircuit({ threshold: 2 });
    circuit.recordFailure(rateLimited());
    circuit.recordFailure(rateLimited());
    circuit.recordSuccess();
    expect(circuit.shouldStop).toBe(true);
  });

  it('回報連續次數供告警訊息使用', () => {
    const circuit = new RateLimitCircuit({ threshold: 5 });
    circuit.recordFailure(rateLimited());
    circuit.recordFailure(rateLimited());
    expect(circuit.consecutiveCount).toBe(2);
  });

  it('門檻預設為 5', () => {
    const circuit = new RateLimitCircuit();
    for (let i = 0; i < 4; i++) circuit.recordFailure(rateLimited());
    expect(circuit.shouldStop).toBe(false);
    circuit.recordFailure(rateLimited());
    expect(circuit.shouldStop).toBe(true);
  });
});
