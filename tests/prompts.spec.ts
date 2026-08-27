import { describe, expect, it } from 'vitest';
import {
  buildCustomizationPrompt,
  buildEvaluationPrompt,
  CustomizationPromptParams,
} from '../src/ai/prompts';

const baseParams: CustomizationPromptParams = {
  resume: '具備 1 年 Python 開發與 LLM Agent 落地實務經驗。',
  companyName: '測試科技股份有限公司',
  jobTitle: 'AI 應用工程師',
  sanitizedJd: '負責開發自動化工作流與 RAG 系統。',
};

describe('buildCustomizationPrompt — 決策分流', () => {
  const applyPrompt = buildCustomizationPrompt({
    ...baseParams,
    evaluationContext: {
      strengths: ['Python 自動化實作經驗', 'RAG 架構'],
      gaps: [],
      decision: 'apply',
    },
  });

  const maybePrompt = buildCustomizationPrompt({
    ...baseParams,
    evaluationContext: {
      strengths: ['Python 自動化'],
      gaps: ['缺乏 Golang 開發經驗'],
      decision: 'maybe',
    },
  });

  it("decision 'apply' 走 Plan 1 - STAR 成就量化型", () => {
    expect(applyPrompt).toContain('Plan 1');
    expect(applyPrompt).toContain('STAR');
    expect(applyPrompt).toContain('量化成效');
  });

  it("decision 'apply' 嚴禁混入 Plan 2", () => {
    expect(applyPrompt).not.toContain('Plan 2');
  });

  it("decision 'maybe' 走 Plan 2 - 特質遷移型", () => {
    expect(maybePrompt).toContain('Plan 2');
    expect(maybePrompt).toContain('特質遷移');
    expect(maybePrompt).toContain('待補強領域');
  });

  it("decision 'maybe' 嚴禁混入 Plan 1", () => {
    expect(maybePrompt).not.toContain('Plan 1');
  });
});

describe('buildCustomizationPrompt — 評估上下文注入', () => {
  const contextPrompt = buildCustomizationPrompt({
    ...baseParams,
    evaluationContext: {
      strengths: ['Python RAG 實作經驗'],
      gaps: ['缺乏 Golang'],
      decision: 'maybe',
    },
  });

  it('注入經驗證的優勢區塊與內容', () => {
    expect(contextPrompt).toContain('【經驗證的求職者優勢】');
    expect(contextPrompt).toContain('Python RAG 實作經驗');
  });

  it('注入技能落差區塊與內容', () => {
    expect(contextPrompt).toContain('【職缺要求的技能落差/待補強領域】');
    expect(contextPrompt).toContain('缺乏 Golang');
  });
});

describe('buildCustomizationPrompt — 安全邊界', () => {
  it("decision 'skip' 必須拋出防護錯誤阻斷生成", () => {
    expect(() =>
      buildCustomizationPrompt({
        ...baseParams,
        evaluationContext: {
          strengths: [],
          gaps: ['不符年資', '缺乏核心技能'],
          decision: 'skip',
        },
      }),
    ).toThrow(/skip/);
  });

  it('evaluationContext 為空時安全 fallback 至 Plan 1', () => {
    const fallbackPrompt = buildCustomizationPrompt({
      ...baseParams,
      evaluationContext: undefined,
    });
    expect(fallbackPrompt).toContain('Plan 1');
    expect(fallbackPrompt).not.toContain('Plan 2');
  });
});

describe('buildCustomizationPrompt — 輸出契約與 Guardrails', () => {
  const prompt = buildCustomizationPrompt({
    ...baseParams,
    evaluationContext: { strengths: ['Python'], gaps: [], decision: 'apply' },
  });

  it('輸出 JSON 只要求 coverLetter', () => {
    expect(prompt).toContain('"coverLetter"');
  });

  it('不得包含已停用的 optimizedSelfIntro', () => {
    expect(prompt).not.toContain('"optimizedSelfIntro"');
  });

  it.each([
    '嚴禁空泛寒暄',
    '絕對事實錨定',
    '第一人稱視角翻轉',
    '弱點主動覆蓋',
    '長度嚴格限制',
    '爆發力（Burstiness）',
    '困惑度（Perplexity）',
    '嚴格負面詞彙表',
    '破除剛性句型',
  ])('包含防護規則：%s', rule => {
    expect(prompt).toContain(rule);
  });
});

describe('buildEvaluationPrompt — 單次呼叫統合 Prompt', () => {
  const unifiedPrompt = buildEvaluationPrompt({
    resume: baseParams.resume,
    companyName: baseParams.companyName,
    jobTitle: baseParams.jobTitle,
    sanitizedJd: baseParams.sanitizedJd,
  });

  it.each(['skillMatch', 'experienceMatch', 'coverLetter'])(
    '包含輸出欄位 %s',
    field => {
      expect(unifiedPrompt).toContain(field);
    },
  );

  it('同時承載雙軌策略，讓模型依決策自行分流', () => {
    expect(unifiedPrompt).toContain('Plan 1');
    expect(unifiedPrompt).toContain('Plan 2');
  });

  it.each(['爆發力（Burstiness）', '嚴格負面詞彙表', '絕對事實錨定'])(
    '包含反機器人規則：%s',
    rule => {
      expect(unifiedPrompt).toContain(rule);
    },
  );
});
