import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '..', 'src', 'preflight-104.ts'),
  'utf8',
);
const packageJson = fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8');

describe('單筆 104 preflight 安全邊界', () => {
  it('必須要求明確 job ID，避免批次掃描', () => {
    expect(source).toContain("process.argv.indexOf('--job-id')");
  });

  it.each([
    'resumePath',
    'LLMFactory',
    'JobDatabase',
    'saveToNotion',
    'sendTelegramMessage',
    'applyToJob',
  ])('不得讀取或呼叫 %s', forbidden => {
    expect(source).not.toContain(forbidden);
  });

  it('必須只呼叫唯讀表單檢查', () => {
    expect(source).toContain('preflightApplication(jobId, { pauseBeforeClose: true })');
  });

  it('package script 必須強制可見模式並要求 --job-id', () => {
    expect(packageJson).toContain(
      '"preflight-104:review": "AUTOJOB_HEADLESS=false ts-node src/preflight-104.ts --job-id"',
    );
  });
});
