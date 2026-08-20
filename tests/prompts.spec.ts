import { buildCustomizationPrompt, CustomizationPromptParams } from '../src/ai/prompts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[AssertionFailed] ${message}`);
  }
}

function run(): void {
  const baseParams: CustomizationPromptParams = {
    resume: '具備 1 年 Python 開發與 LLM Agent 落地實務經驗。',
    companyName: '測試科技股份有限公司',
    jobTitle: 'AI 應用工程師',
    sanitizedJd: '負責開發自動化工作流與 RAG 系統。',
  };

  // 1. 決策分流斷言 (Routing Assertion)
  console.log('[1/4] 決策分流斷言 (Routing Assertion)...');
  {
    // (a) decision: 'apply' -> Plan 1
    const applyPrompt = buildCustomizationPrompt({
      ...baseParams,
      evaluationContext: {
        strengths: ['Python 自動化實作經驗', 'RAG 架構'],
        gaps: [],
        decision: 'apply',
      },
    });
    assert(applyPrompt.includes('Plan 1'), "decision === 'apply' 時 Prompt 必須包含 'Plan 1'");
    assert(applyPrompt.includes('STAR'), "decision === 'apply' 時 Prompt 必須包含 'STAR'");
    assert(applyPrompt.includes('量化成效'), "decision === 'apply' 時 Prompt 必須包含 '量化成效'");
    assert(!applyPrompt.includes('Plan 2'), "decision === 'apply' 時 Prompt 嚴禁包含 'Plan 2'");

    // (b) decision: 'maybe' -> Plan 2
    const maybePrompt = buildCustomizationPrompt({
      ...baseParams,
      evaluationContext: {
        strengths: ['Python 自動化'],
        gaps: ['缺乏 Golang 開發經驗'],
        decision: 'maybe',
      },
    });
    assert(maybePrompt.includes('Plan 2'), "decision === 'maybe' 時 Prompt 必須包含 'Plan 2'");
    assert(maybePrompt.includes('特質遷移'), "decision === 'maybe' 時 Prompt 必須包含 '特質遷移'");
    assert(maybePrompt.includes('待補強領域'), "decision === 'maybe' 時 Prompt 必須包含 '待補強領域'");
    assert(!maybePrompt.includes('Plan 1'), "decision === 'maybe' 時 Prompt 嚴禁包含 'Plan 1'");
  }

  // 2. 評估上下文整合斷言 (Context Injection)
  console.log('[2/4] 評估上下文整合斷言 (Context Injection)...');
  {
    const contextPrompt = buildCustomizationPrompt({
      ...baseParams,
      evaluationContext: {
        strengths: ['Python RAG 實作經驗'],
        gaps: ['缺乏 Golang'],
        decision: 'maybe',
      },
    });
    assert(contextPrompt.includes('【經驗證的求職者優勢】'), "Prompt 必須包含「【經驗證的求職者優勢】」區塊");
    assert(contextPrompt.includes('Python RAG 實作經驗'), "Prompt 必須注入 strengths 內容");
    assert(contextPrompt.includes('【職缺要求的技能落差/待補強領域】'), "Prompt 必須包含「【職缺要求的技能落差/待補強領域】」區塊");
    assert(contextPrompt.includes('缺乏 Golang'), "Prompt 必須注入 gaps 內容");
  }

  // 3. 安全邊界斷言 (Edge Cases)
  console.log('[3/4] 安全邊界斷言 (Edge Cases)...');
  {
    // (a) decision: 'skip' 應拋出防護錯誤
    let skipErrorThrown = false;
    try {
      buildCustomizationPrompt({
        ...baseParams,
        evaluationContext: {
          strengths: [],
          gaps: ['不符年資', '缺乏核心技能'],
          decision: 'skip',
        },
      });
    } catch (e: any) {
      skipErrorThrown = true;
      assert(e.message.includes('skip'), "skip 錯誤訊息應提及 'skip'");
    }
    assert(skipErrorThrown, "decision === 'skip' 時必須拋出防護錯誤阻斷生成");

    // (b) evaluationContext 為空時，預設 fallback 至安全模式 (Plan 1)
    const fallbackPrompt = buildCustomizationPrompt({
      ...baseParams,
      evaluationContext: undefined,
    });
    assert(fallbackPrompt.includes('Plan 1'), 'evaluationContext 為空時應安全 fallback 至 Plan 1');
    assert(!fallbackPrompt.includes('Plan 2'), 'evaluationContext 為空 fallback 時不應包含 Plan 2');
  }

  // 4. 輸出格式契約與防護規則斷言 (Schema & Guardrails Verification)
  console.log('[4/4] 輸出格式契約與防護規則斷言 (Schema & Guardrails)...');
  {
    const prompt = buildCustomizationPrompt({
      ...baseParams,
      evaluationContext: {
        strengths: ['Python'],
        gaps: [],
        decision: 'apply',
      },
    });

    // 格式契約：僅要求 coverLetter
    assert(prompt.includes('"coverLetter"'), "輸出 JSON 格式必須包含 'coverLetter'");
    assert(!prompt.includes('"optimizedSelfIntro"'), "輸出 JSON 格式不得包含已停用的 'optimizedSelfIntro'");

    // 五大硬性防護規則與去機器人化特徵
    assert(prompt.includes('嚴禁空泛寒暄'), 'Prompt 必須包含防護規則：嚴禁空泛寒暄');
    assert(prompt.includes('絕對事實錨定'), 'Prompt 必須包含防護規則：絕對事實錨定');
    assert(prompt.includes('第一人稱視角翻轉'), 'Prompt 必須包含防護規則：第一人稱視角翻轉');
    assert(prompt.includes('弱點主動覆蓋'), 'Prompt 必須包含防護規則：弱點主動覆蓋');
    assert(prompt.includes('長度嚴格限制'), 'Prompt 必須包含防護規則：長度嚴格限制');
    assert(prompt.includes('爆發力（Burstiness）'), 'Prompt 必須包含反機器人規則：爆發力句長控制');
    assert(prompt.includes('困惑度（Perplexity）'), 'Prompt 必須包含反機器人規則：提高困惑度與真實細節');
    assert(prompt.includes('嚴格負面詞彙表'), 'Prompt 必須包含反機器人規則：嚴格負面詞彙表');
    assert(prompt.includes('破除剛性句型'), 'Prompt 必須包含反機器人規則：破除剛性句型');
  }

  // 5. 單次呼叫統合 Prompt 斷言 (Unified One-Shot Prompt Assertion)
  console.log('[5/5] 單次呼叫統合 Prompt 斷言 (Unified One-Shot Evaluation + Cover Letter)...');
  {
    const { buildEvaluationPrompt } = require('../src/ai/prompts');
    const unifiedPrompt = buildEvaluationPrompt({
      resume: baseParams.resume,
      companyName: baseParams.companyName,
      jobTitle: baseParams.jobTitle,
      sanitizedJd: baseParams.sanitizedJd,
    });

    assert(unifiedPrompt.includes('skillMatch'), "Unified Prompt 必須包含量化評分指標 'skillMatch'");
    assert(unifiedPrompt.includes('experienceMatch'), "Unified Prompt 必須包含量化評分指標 'experienceMatch'");
    assert(unifiedPrompt.includes('coverLetter'), "Unified Prompt 輸出格式必須包含 'coverLetter'");
    assert(unifiedPrompt.includes('Plan 1'), "Unified Prompt 必須包含 'Plan 1'");
    assert(unifiedPrompt.includes('Plan 2'), "Unified Prompt 必須包含 'Plan 2'");
    assert(unifiedPrompt.includes('爆發力（Burstiness）'), "Unified Prompt 必須包含爆發力控制");
    assert(unifiedPrompt.includes('嚴格負面詞彙表'), "Unified Prompt 必須包含負面詞彙表");
    assert(unifiedPrompt.includes('絕對事實錨定'), "Unified Prompt 必須包含絕對事實錨定");
  }
}

try {
  run();
  console.log('PASS: 自薦信 Dual-Strategy Routing 與 Guardrails 單元測試 100% 通過！');
} catch (error) {
  console.error(error);
  process.exit(1);
}
