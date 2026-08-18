/**
 * Centralized AI Prompts for Evaluation and Customization.
 * Edit this file to customize evaluation criteria, scoring rubrics, cover letter tone, and writing styles.
 */

import { DecisionType } from '../types';

export interface EvaluationPromptParams {
  resume: string;
  companyName: string;
  jobTitle: string;
  sanitizedJd: string;
}

export interface CustomizationPromptParams {
  resume: string;
  companyName: string;
  jobTitle: string;
  sanitizedJd: string;
  evaluationContext?: {
    strengths?: string[];
    gaps?: string[];
    decision?: DecisionType;
  };
}

/**
 * Builds the structured job evaluation prompt.
 */
export function buildEvaluationPrompt(params: EvaluationPromptParams): string {
  return `你是一位專業的科技業職涯顧問與人資專家。請根據以下加權評分量表，客觀比對求職者履歷與職缺 JD。

【求職者履歷摘要】
${params.resume}

【目標公司】
${params.companyName}

【目標職缺】
${params.jobTitle}

--- 以下為待評估資料 ---
【職缺 JD 內容】
${params.sanitizedJd}
--- 待評估資料結束 ---

請依照以下加權量表逐項評分：
1. skillMatch (0-40分)
2. experienceMatch (0-25分)
3. domainMatch (0-15分)
4. educationMatch (0-5分)
5. bonusMatch (0-15分)

請【嚴格】只輸出以下 JSON 格式：
{
  "breakdown": {
    "skillMatch": 30,
    "experienceMatch": 15,
    "domainMatch": 10,
    "educationMatch": 3,
    "bonusMatch": 8
  },
  "confidence": 0.75,
  "strengths": ["優勢1", "優勢2"],
  "gaps": ["不足1"],
  "mustHaveMatches": [
    {"item": "必備條件1", "status": "matched"}
  ],
  "reason": "評估理由。"
}`;
}

/**
 * Builds the cover letter customization prompt with Dual-Strategy Routing.
 */
export function buildCustomizationPrompt(params: CustomizationPromptParams): string {
  const rawDecision = params.evaluationContext?.decision;
  const decision: DecisionType = rawDecision ? (rawDecision.toLowerCase() as DecisionType) : 'apply';

  if (decision === 'skip') {
    throw new Error('[PromptGuard] decision 為 skip 時不應生成自薦信。');
  }

  // 1. 評估上下文處理 (Context Injection)
  const contextParts: string[] = [];
  if (params.evaluationContext?.strengths && params.evaluationContext.strengths.length > 0) {
    contextParts.push(`【經驗證的求職者優勢】\n${params.evaluationContext.strengths.map(s => `• ${s}`).join('\n')}`);
  }
  if (params.evaluationContext?.gaps && params.evaluationContext.gaps.length > 0) {
    contextParts.push(`【職缺要求的技能落差/待補強領域】\n${params.evaluationContext.gaps.map(g => `• ${g}`).join('\n')}`);
  }
  contextParts.push(`【AI 評估決策】：${decision}`);
  const evalContextSection = `\n【AI 評估分析結果】\n${contextParts.join('\n\n')}\n`;

  // 2. 策略分流提示詞 (Strategy-specific instructions)
  let strategySection = '';
  if (decision === 'apply') {
    strategySection = `【採用架構：Plan 1 - STAR 成就量化型】
1. 首段：精準破題，指出技術棧與職缺核心需求交集。
2. 次段：嚴格採用 STAR 原則，從履歷提取量化成效（如專案成效、流程數、節省人時、架構穩定度等數據實績），證明即戰力。
3. 尾段：說明該經驗如何立即為目標公司縮短交付週期或創造商業價值。`;
  } else if (decision === 'maybe') {
    strategySection = `【採用架構：Plan 2 - 特質遷移與弱點補強型】
1. 首段：破題並展現對該職位核心挑戰與業務理解。
2. 次段：針對【職缺要求的技能落差/待補強領域】，提取履歷中相通的底層架構邏輯、工程思維或相關實務經歷進行特質遷移證明，化解 Gaps。
3. 尾段：強調工程敏捷適應力、快速學習上手能力與解決未知問題的主動性。`;
  }

  // 3. 五大硬性防護規則 (Guardrails)
  const guardrailsSection = `【五大硬性防護規則 (Guardrails)】
1. 嚴禁空泛寒暄：禁止「您好，在 104 看到...」、「希望能給我一個機會」、「貴公司享有盛名」等無意義客套。
2. 絕對事實錨定：嚴禁發明履歷未提及的工具、語言、專案或數據，所有技能與成效必須有履歷依據。
3. 第一人稱視角翻轉：聚焦能為目標公司解決什麼問題、帶來什麼價值，而非個人想學到什麼或追求自我成長。
4. 弱點主動覆蓋：不道歉、不示弱，使用相通技術進行架構維度補強與遷移能力證明。
5. 長度嚴格限制：150 ~ 250 字繁體中文。`;

  return `你是一位專業且極具說服力的求職者。請根據以下「求職者履歷」、「職缺 JD」與「AI 評估分析結果」，為目標職缺生成一份高轉換率的客製化「自我推薦信」。

【求職者履歷摘要】
${params.resume}

【目標公司】
${params.companyName}

【目標職缺】
${params.jobTitle}
${evalContextSection}
--- 以下為待評估資料 ---
【職缺 JD 內容】
${params.sanitizedJd}
--- 待評估資料結束 ---

${strategySection}

${guardrailsSection}

請【嚴格】輸出以下 JSON 格式：
{
  "coverLetter": "填寫符合上述策略與防護規則的客製化自我推薦信（150-250 字繁體中文）。"
}`;
}
