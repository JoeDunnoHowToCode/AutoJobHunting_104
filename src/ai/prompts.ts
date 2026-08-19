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
 * Builds the cover letter customization prompt with Dual-Strategy Routing and Anti-Robot Style Guardrails.
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

  // 2. 雙軌動態策略分流 (Dual-Strategy Routing)
  let strategySection = '';
  if (decision === 'apply') {
    strategySection = `【採用策略：Plan 1 - STAR 成就量化型】
- 首段：極短句破題，直指實戰背景與 JD 核心難題交集。
- 次段：嚴格採用 STAR 原則，從履歷提取量化成效（提及具體工具如 Python、OpenCV、Cursor 與真實數據如 5 條 RPA、6+ 人時、斷點續跑機制），展現即戰力與系統穩定性。
- 尾段：說明如何以 AI 提速與工程實務直接為團隊貢獻產出。`;
  } else if (decision === 'maybe') {
    strategySection = `【採用策略：Plan 2 - 特質遷移與弱點補強型】
- 首段：展現對該職位核心架構與業務難題的理解。
- 次段：針對【職缺要求的技能落差/待補強領域】，提取履歷中相通的底層工程邏輯、問題解決架構或相近技術實作進行特質遷移證明，主動化解 Gaps。
- 尾段：強調工程適應力、快速上手能力與克服未知技術的主動性。`;
  }

  // 3. 語言數學特徵控制與硬性防護規則 (Anti-Robot Language Control & Guardrails)
  const antiRobotRules = `【語言特徵控制與五大硬性防護規則 (Anti-Robot Guardrails)】
1. 爆發力（Burstiness）節奏控制（徹底破除 AI 均勻平乏節奏，長短句錯落）：
   - 30% 極短衝擊句（5-12 字）：用於破題、轉折或結尾（例：「系統穩健是第一考量。」、「上線至今零故障。」、「邏輯完全相通。」）。
   - 50% 中等長度句（13-25 字）：承載技術方案與因果關係。
   - 20% 複雜長句（26 字以上）：描繪具體架構、邊界處理或數據成果。
2. 提高困惑度（Perplexity）與絕對事實錨定：
   - 必須提取具體的「真實細節」：明確寫出工具名稱、架構元件與數據指標（如 OpenCV、斷點續跑、5 條 RPA 流程、6+ 人時），嚴禁抽象概括或發明履歷未提及的內容。
3. 嚴格負面詞彙表（絕對禁止出現以下空泛 AI 詞彙）：
   - 嚴禁詞彙：扎實、顯著提升、賦能、快節奏、竭誠、深耕、致力於、全面、不遺餘力、期盼能運用...、在當今...、高度契合。
4. 破除剛性句型與嚴禁空泛寒暄：
   - 嚴禁空泛寒暄：禁止「您好，在 104 看到...」、「希望能給我一個機會」、「貴公司享有盛名」等無意義客套。
   - 嚴禁使用「面對...需求，我具備...」或「針對...需求，我熟稔...」等套版句型。
   - 嚴禁結尾使用對稱排比句（如「運用 A 與 B，協助貴公司達成 C 與 D」）。
5. 第一人稱視角翻轉與弱點主動覆蓋：
   - 聚焦能為目標公司解決什麼問題、帶來什麼價值，而非個人自我成長。
   - 弱點主動覆蓋：不道歉、不示弱，用相通底層技術與遷移能力填補落差。
6. 長度嚴格限制：繁體中文總字數嚴格控制在 160 ~ 200 字（絕對不可超過 220 字）。

【建議段落結構範本（請依據此節奏書寫，總長 3 段）】：
段落 1（破題短句 + 核心交集，約 35 字）：應徵 [目標職缺]。貴團隊需要的 [JD核心挑戰]，正是我在 [專案/前職] 最常處理的題目。
段落 2（具體事實 + 數據 + 邊界處理，約 110 字）：我獨立負責過 [具體專案/5條RPA管線]，從訪談一路做到上線維運。遇到 [具體問題]，直接用 [工具] 寫 [解法] 解掉；同時建立 [斷點續跑機制]，每日釋放 6+ 人時。系統穩健是第一考量。
段落 3（AI協作 + 價值收尾，約 40 字）：習慣在開發中導入 AI 輔助提速。期待能把這套 [實務技能] 經驗帶進團隊，直接投入實戰。`;

  return `你是一位直率、專業的資深軟體工程師。請根據以下資料，為求職者撰寫一份「徹底去除 AI 腔調、高衝擊力、自然人類筆觸」的 104 自我推薦信。

【求職者真實履歷】
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

${antiRobotRules}

請【嚴格】輸出以下 JSON 格式：
{
  "coverLetter": "填寫符合上述爆發力、去機器人化規則與長度限制的客製化自我推薦信（160-200字繁中）。"
}`;
}
