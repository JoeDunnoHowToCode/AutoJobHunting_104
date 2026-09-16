import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendTransientLog, TransientLogEntry } from '../src/transient-log';

function entry(overrides: Partial<TransientLogEntry> = {}): TransientLogEntry {
  return {
    jobId: 'abc12',
    title: 'AI 工程師',
    stage: 'llm',
    kind: 'rate_limited',
    reason: 'HTTP 429',
    ...overrides,
  };
}

function readLines(logPath: string): string[] {
  return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

describe('appendTransientLog', () => {
  let directory: string;
  let logPath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-tlog-'));
    logPath = path.join(directory, 'logs', 'transient.jsonl');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('目標目錄不存在時自動建立', () => {
    appendTransientLog(entry(), logPath);
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('寫入一行合法 JSON', () => {
    appendTransientLog(entry(), logPath);
    const lines = readLines(logPath);
    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('連續寫入為 append，不覆寫先前內容', () => {
    appendTransientLog(entry({ jobId: 'first' }), logPath);
    appendTransientLog(entry({ jobId: 'second' }), logPath);
    appendTransientLog(entry({ jobId: 'third' }), logPath);

    const ids = readLines(logPath).map(line => JSON.parse(line).jobId);
    expect(ids).toEqual(['first', 'second', 'third']);
  });

  it('每行都帶 ts 與必要欄位', () => {
    appendTransientLog(entry(), logPath);
    const parsed = JSON.parse(readLines(logPath)[0]);

    expect(parsed).toMatchObject({
      jobId: 'abc12',
      title: 'AI 工程師',
      stage: 'llm',
      kind: 'rate_limited',
      reason: 'HTTP 429',
    });
    expect(typeof parsed.ts).toBe('string');
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false);
  });

  it('reason 含換行與引號時 JSONL 不被破壞', () => {
    const nasty = 'line one\nline two "quoted" \\ backslash\ttab';
    appendTransientLog(entry({ reason: nasty }), logPath);
    appendTransientLog(entry({ jobId: 'after' }), logPath);

    const lines = readLines(logPath);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).reason).toBe(nasty);
    expect(JSON.parse(lines[1]).jobId).toBe('after');
  });

  it('寫入失敗不得中斷主流程', () => {
    // A directory where the log file path should be forces a write error.
    fs.mkdirSync(logPath, { recursive: true });
    expect(() => appendTransientLog(entry(), logPath)).not.toThrow();
  });
});
