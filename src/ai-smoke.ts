import { LLMFactory } from './ai/factory';
import { config } from './config';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * An opt-in, online smoke test for the currently configured provider.
 *
 * The provider builds a summary from resume.json, so this command sends that
 * summary to the configured LLM service. It is intentionally not part of the
 * offline test suite.
 */
async function run(): Promise<void> {
  console.log('==================================================');
  console.log('LLM 線上 Smoke Test（僅目前設定的 Provider）');
  console.log('==================================================');
  console.log(`Provider: ${config.aiProvider}`);
  console.log(`Model: ${config.aiModel}`);
  console.log('注意：此測試會將履歷摘要傳送至目前設定的 LLM 服務。');

  const provider = LLMFactory.getProvider();
  const evaluation = await provider.evaluateJob(
    'AI 應用工程師',
    '測試科技股份有限公司',
    '負責開發基於 LLM 的應用系統，串接 API 與 RAG 知識庫。',
  );

  assert(Number.isFinite(evaluation.score), 'LLM 評估結果缺少有效分數。');
  assert(Boolean(evaluation.decision), 'LLM 評估結果缺少決策。');
  console.log(`評估完成：score=${evaluation.score}，decision=${evaluation.decision}`);

  const customization = await provider.generateCustomizedContent(
    'AI 應用工程師',
    '測試科技股份有限公司',
    '負責開發基於 LLM 的應用系統。',
    {
      strengths: evaluation.strengths,
      gaps: evaluation.gaps,
      decision: evaluation.decision,
    },
  );
  assert(customization.coverLetter.trim().length >= 30, 'LLM 未產生有效自薦信。');
  // 【註記保留】：暫時註解停用
  // assert(customization.optimizedSelfIntro.trim().length >= 30, 'LLM 未產生有效自我介紹。');
  console.log(`內容生成完成：自薦信 ${customization.coverLetter.length} 字。`);
  console.log('PASS: LLM 線上 Smoke Test 完成');
}

run().catch(error => {
  console.error('LLM Smoke Test 失敗:', error);
  process.exitCode = 1;
});
