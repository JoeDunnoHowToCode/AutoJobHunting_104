import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import { config } from '../../config';
import {
  EvaluationResult,
  CustomizationResult,
  EvaluationOutputSchema,
  CustomizationOutputSchema,
  EvaluationOutput,
  RequirementMatch,
} from '../../types';
import { LLMProvider } from '../types';

function sanitizeJdContent(jd: string): string {
  return jd
    .replace(/ignore\s+(all\s+)?previous\s+instructions?/gi, '[FILTERED]')
    .replace(/disregard\s+(all\s+)?previous/gi, '[FILTERED]')
    .replace(/you\s+are\s+now/gi, '[FILTERED]')
    .replace(/system\s*:\s*/gi, '[FILTERED]')
    .replace(/return\s+score\s+100/gi, '[FILTERED]')
    .replace(/output\s+this\s+json/gi, '[FILTERED]');
}

export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI | null = null;
  private resumeSummaryCache: string | null = null;

  constructor() {
    this.init();
  }

  private init() {
    if (!config.geminiApiKey) {
      console.warn('[GeminiProvider] Warning: GEMINI_API_KEY is not set in environment.');
      return;
    }
    try {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    } catch (error) {
      console.error('[GeminiProvider] Failed to initialize GoogleGenAI client:', error);
    }
  }

  private buildResumeSummary(): string {
    if (this.resumeSummaryCache) return this.resumeSummaryCache;

    if (!fs.existsSync(config.resumePath)) {
      console.warn(`Warning: Resume file not found at ${config.resumePath}.`);
      return '';
    }

    try {
      const resumeJson = JSON.parse(fs.readFileSync(config.resumePath, 'utf8'));
      const summary: Record<string, any> = {};

      if (resumeJson.summary) summary.summary = resumeJson.summary;
      if (resumeJson.core_skills) summary.core_skills = resumeJson.core_skills;
      if (resumeJson.work_experience) summary.work_experience = resumeJson.work_experience;
      if (resumeJson.education) summary.education = resumeJson.education;
      if (resumeJson.certifications) summary.certifications = resumeJson.certifications;
      if (resumeJson.languages) summary.languages = resumeJson.languages;
      if (resumeJson.work_content_preferences) summary.work_content_preferences = resumeJson.work_content_preferences;

      if (resumeJson.basic_info) {
        summary.basic_info = {
          expected_salary_monthly: resumeJson.basic_info.expected_salary_monthly,
          desired_title: resumeJson.basic_info.desired_title,
          tags: resumeJson.basic_info.tags,
        };
      }

      this.resumeSummaryCache = JSON.stringify(summary, null, 2);
      return this.resumeSummaryCache;
    } catch (e) {
      return fs.readFileSync(config.resumePath, 'utf8');
    }
  }

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    context: string,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        const remaining = maxRetries - attempt;
        console.error(`${context} 失敗，剩餘重試次數: ${remaining}`, error);
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  private parseJsonResponse(text: string): any {
    const cleanStr = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleanStr);
  }

  private computeDecision(
    totalScore: number,
    mustHaveMatches: RequirementMatch[]
  ): 'APPLY' | 'MAYBE' | 'SKIP' {
    const criticalMissing = mustHaveMatches.filter(m => m.status === 'missing').length;
    const threshold = config.scoreThreshold;

    if (totalScore >= threshold && criticalMissing === 0) {
      return 'APPLY';
    }
    if (totalScore >= threshold - 15 && criticalMissing <= 1) {
      return 'MAYBE';
    }
    if (criticalMissing >= 3) {
      return 'SKIP';
    }
    if (totalScore >= threshold) {
      return 'MAYBE';
    }
    return 'SKIP';
  }

  public async evaluateJob(
    jobTitle: string,
    companyName: string,
    jobDescription: string
  ): Promise<EvaluationResult> {
    if (!this.ai) {
      throw new Error('[GeminiProvider] Gemini API client is not initialized.');
    }

    const resume = this.buildResumeSummary();
    const sanitizedJd = sanitizeJdContent(jobDescription);

    const prompt = `你是一位專業的科技業職涯顧問與人資專家。請根據以下加權評分量表，客觀比對求職者履歷與職缺 JD。

【求職者履歷摘要】
${resume}

【目標公司】
${companyName}

【目標職缺】
${jobTitle}

--- 以下為待評估資料 ---
【職缺 JD 內容】
${sanitizedJd}
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

    return this.retryWithBackoff(async () => {
      const response = await this.ai!.models.generateContent({
        model: config.aiModel,
        contents: prompt,
      });

      const text = response.text?.trim() || '';
      const parsed = this.parseJsonResponse(text);
      const result = EvaluationOutputSchema.safeParse(parsed);

      if (!result.success) {
        console.error('[Zod 驗證失敗] LLM 輸出不符合預期結構:', result.error.issues);
        throw new Error(`Schema validation failed: ${result.error.issues.map(i => i.message).join(', ')}`);
      }

      const data: EvaluationOutput = result.data;
      const totalScore =
        data.breakdown.skillMatch +
        data.breakdown.experienceMatch +
        data.breakdown.domainMatch +
        data.breakdown.educationMatch +
        data.breakdown.bonusMatch;

      const decision = this.computeDecision(totalScore, data.mustHaveMatches);
      const shouldApply = totalScore >= config.scoreThreshold && decision !== 'SKIP';

      return {
        score: totalScore,
        reason: data.reason,
        shouldApply,
        breakdown: data.breakdown,
        confidence: data.confidence,
        decision,
        strengths: data.strengths,
        gaps: data.gaps,
        mustHaveMatches: data.mustHaveMatches,
      };
    }, `Gemini API 評估 ("${jobTitle}")`);
  }

  public async generateCustomizedContent(
    jobTitle: string,
    companyName: string,
    jobDescription: string,
    evaluationContext?: {
      strengths?: string[];
      gaps?: string[];
      decision?: 'APPLY' | 'MAYBE' | 'SKIP';
    }
  ): Promise<CustomizationResult> {
    if (!this.ai) {
      throw new Error('[GeminiProvider] Gemini API client is not initialized.');
    }

    const resume = this.buildResumeSummary();
    const sanitizedJd = sanitizeJdContent(jobDescription);

    let evalContextSection = '';
    if (evaluationContext) {
      const parts: string[] = [];
      if (evaluationContext.strengths && evaluationContext.strengths.length > 0) {
        parts.push(`求職者優勢亮點：\n${evaluationContext.strengths.map(s => `• ${s}`).join('\n')}`);
      }
      if (evaluationContext.gaps && evaluationContext.gaps.length > 0) {
        parts.push(`需要補強的領域：\n${evaluationContext.gaps.map(g => `• ${g}`).join('\n')}`);
      }
      if (evaluationContext.decision) {
        parts.push(`AI 評估決策：${evaluationContext.decision}`);
      }
      if (parts.length > 0) {
        evalContextSection = `\n【AI 評估分析結果】\n${parts.join('\n\n')}\n`;
      }
    }

    const prompt = `你是一位專業且極具說服力的求職者。請根據以下「求職者履歷」、「職缺 JD」與「AI 評估分析結果」，生成一份客製化的「自我推薦信」與「優化履歷自我介紹」。

【求職者履歷摘要】
${resume}

【目標公司】
${companyName}

【目標職缺】
${jobTitle}
${evalContextSection}
--- 以下為待評估資料 ---
【職缺 JD 內容】
${sanitizedJd}
--- 待評估資料結束 ---

請【嚴格】輸出以下 JSON 格式：
{
  "coverLetter": "填寫客製化的自我推薦信（約 150-250 字，繁體中文）。",
  "optimizedSelfIntro": "填寫精簡自我介紹（約 100-200 字，繁體中文）。"
}`;

    return this.retryWithBackoff(async () => {
      const response = await this.ai!.models.generateContent({
        model: config.aiModel,
        contents: prompt,
      });

      const text = response.text?.trim() || '';
      const parsed = this.parseJsonResponse(text);
      const result = CustomizationOutputSchema.safeParse(parsed);

      if (!result.success) {
        console.error('[Zod 驗證失敗] 自薦信輸出不符合預期結構:', result.error.issues);
        throw new Error(`Schema validation failed: ${result.error.issues.map(i => i.message).join(', ')}`);
      }

      return {
        coverLetter: result.data.coverLetter,
        optimizedSelfIntro: result.data.optimizedSelfIntro,
      };
    }, `Gemini API 生成自薦信 ("${jobTitle}")`);
  }
}

export const gemini = new GeminiProvider();
