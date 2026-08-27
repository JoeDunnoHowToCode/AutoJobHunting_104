import * as fs from 'fs';
import * as path from 'path';
import PQueue from 'p-queue';
import { describe, expect, it } from 'vitest';
import { applyPriorityForScore } from '../src/apply-priority';

describe('applyPriorityForScore', () => {
  it('分數越高優先權越高', () => {
    expect(applyPriorityForScore(95)).toBeGreaterThan(applyPriorityForScore(65));
  });

  it('相同分數給相同優先權', () => {
    expect(applyPriorityForScore(80)).toBe(applyPriorityForScore(80));
  });

  it('分數為 0 時仍回合法的非負優先權', () => {
    expect(applyPriorityForScore(0)).toBeGreaterThanOrEqual(0);
  });
});

describe('applyQueue 以分數決定投遞順序', () => {
  // 現況是 FIFO：先評估完的先投。額度用完時留下的是「先算完的」
  // 而不是「分數最高的」。已投遞的 382 筆平均 74.1 分，但 85 分以上只有 52 筆。
  it('高分職缺先於低分職缺被投遞', async () => {
    const queue = new PQueue({ concurrency: 1, autoStart: false });
    const order: number[] = [];

    for (const score of [65, 95, 75, 88]) {
      void queue.add(async () => { order.push(score); }, {
        priority: applyPriorityForScore(score),
      });
    }

    queue.start();
    await queue.onIdle();

    expect(order).toEqual([95, 88, 75, 65]);
  });

  it('加了 priority 之後仍嚴格單線，不得併發', async () => {
    const queue = new PQueue({ concurrency: 1 });
    let active = 0;
    let maximum = 0;

    for (const score of [70, 90, 60]) {
      void queue.add(
        async () => {
          active++;
          maximum = Math.max(maximum, active);
          await new Promise(resolve => setTimeout(resolve, 5));
          active--;
        },
        { priority: applyPriorityForScore(score) },
      );
    }
    await queue.onIdle();

    expect(maximum).toBe(1);
  });
});

describe('index.ts 實際接線', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8');

  // 距離型的正則（add( ... priority 之間 N 字元內）在這裡不可行：
  // enqueueApply 的 task 主體有上百行，選項物件在最後面。改為比對具體字串。
  it('applyQueue.add 必須帶入以分數計算的 priority', () => {
    expect(source).toContain('{ priority: applyPriorityForScore(score) }');
  });

  it('priority 只用在 applyQueue，不得誤加到 jd/llm 佇列', () => {
    expect(source).not.toMatch(/jdQueue\.add\([\s\S]*?priority:/);
    expect(source).not.toMatch(/llmQueue\.add\([\s\S]*?priority:/);
  });

  it('applyQueue 併發數必須維持 1', () => {
    expect(source).toContain('new PQueue({ concurrency: 1 })');
  });
});
