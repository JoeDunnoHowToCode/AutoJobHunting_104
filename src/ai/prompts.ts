/**
 * Centralized AI Prompts for Evaluation and Customization.
 * Edit this file to customize evaluation criteria, scoring rubrics, cover letter tone, and writing styles.
 */

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
    decision?: 'APPLY' | 'MAYBE' | 'SKIP';
  };
}

/**
 * Builds the structured job evaluation prompt.
 */
export function buildEvaluationPrompt(params: {
  resume: string;
  companyName: string;
  jobTitle: string;
  sanitizedJd: string;
}): string {
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
 * Builds the cover letter and pitch customization prompt.
 */
export function buildCustomizationPrompt(params: CustomizationPromptParams): string {
  let evalContextSection = '';
  if (params.evaluationContext) {
    const parts: string[] = [];
    if (params.evaluationContext.strengths && params.evaluationContext.strengths.length > 0) {
      parts.push(`求職者優勢亮點：\n${params.evaluationContext.strengths.map(s => `• ${s}`).join('\n')}`);
    }
    if (params.evaluationContext.gaps && params.evaluationContext.gaps.length > 0) {
      parts.push(`需要補強的領域：\n${params.evaluationContext.gaps.map(g => `• ${g}`).join('\n')}`);
    }
    if (params.evaluationContext.decision) {
      parts.push(`AI 評估決策：${params.evaluationContext.decision}`);
    }
    if (parts.length > 0) {
      evalContextSection = `\n【AI 評估分析結果】\n${parts.join('\n\n')}\n`;
    }
  }

  return `你是一位專業且極具說服力的求職者。請根據以下「求職者履歷」、「職缺 JD」與「AI 評估分析結果」，生成一份客製化的「自我推薦信」與「優化履歷自我介紹」。

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

請【嚴格】輸出以下 JSON 格式：
{
  "coverLetter": "填寫客製化的自我推薦信（約 150-250 字，繁體中文，強調與 JD 核心需求的強匹配度與解決問題之能力）。",
  "optimizedSelfIntro": "填寫精簡自我介紹（約 100-200 字，繁體中文）。"
}`;
}
