import OpenAI from 'openai';
import * as fs from 'fs';
import { LLMProvider } from '../types';
import { config } from '../../config';
import { retryTransient } from '../retry';
import { EVALUATION_JSON_SCHEMA, CUSTOMIZATION_JSON_SCHEMA } from '../schemas';
import {
  EvaluationResult,
  CustomizationResult,
  EvaluationOutputSchema,
  CustomizationOutputSchema,
  EvaluationOutput,
  RequirementMatch,
} from '../../types';

function sanitizeJdContent(jd: string): string {
  return jd
    .replace(/ignore\s+(all\s+)?previous\s+instructions?/gi, '[FILTERED]')
    .replace(/disregard\s+(all\s+)?previous/gi, '[FILTERED]')
    .replace(/you\s+are\s+now/gi, '[FILTERED]')
    .replace(/system\s*:\s*/gi, '[FILTERED]')
    .replace(/return\s+score\s+100/gi, '[FILTERED]')
    .replace(/output\s+this\s+json/gi, '[FILTERED]');
}

export class OpenRouterProvider implements LLMProvider {
  private client: OpenAI | null = null;
  private model: string;
  private resumeSummaryCache: string | null = null;

  constructor() {
    this.model = config.aiModel;
    const apiKey = config.openrouterApiKey;
    if (!apiKey) {
      console.warn('[OpenRouterProvider] Warning: OPENROUTER_API_KEY is not set.');
      return;
    }

    try {
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: {
          'HTTP-Referer': 'https://github.com/auto-job-hunter',
          'X-Title': 'AutoJobHunter',
        },
      });
    } catch (err) {
      console.error('[OpenRouterProvider] Failed to initialize OpenRouter client:', err);
    }
  }

  private buildResumeSummary(): string {
    if (this.resumeSummaryCache) return this.resumeSummaryCache;
    if (!fs.existsSync(config.resumePath)) return '';
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

  private computeDecision(
    totalScore: number,
    mustHaveMatches: RequirementMatch[]
  ): 'APPLY' | 'MAYBE' | 'SKIP' {
    const criticalMissing = mustHaveMatches.filter(m => m.status === 'missing').length;
    const threshold = config.scoreThreshold;

    if (totalScore >= threshold && criticalMissing === 0) return 'APPLY';
    if (totalScore >= threshold - 15 && criticalMissing <= 1) return 'MAYBE';
    if (criticalMissing >= 3) return 'SKIP';
    if (totalScore >= threshold) return 'MAYBE';
    return 'SKIP';
  }

  public async evaluateJob(
    jobTitle: string,
    companyName: string,
    jobDescription: string
  ): Promise<EvaluationResult> {
    if (!this.client) {
      throw new Error('[OpenRouterProvider] OPENROUTER_API_KEY 未設定或客戶端初始化失敗。');
    }

    const sanitizedJd = sanitizeJdContent(jobDescription);
    const resume = this.buildResumeSummary();
    const systemPrompt = `你是一位專業的科技業職涯顧問與人資專家。請根據加權評分量表比對求職者與職缺，並【嚴格】輸出標準 JSON 格式。\n\n【求職者履歷摘要】\n${resume}`;
    const userPrompt = `
【目標公司】: ${companyName}
【目標職缺】: ${jobTitle}
【職缺 JD】: ${sanitizedJd}

請輸出以下 JSON 結構：
{
  "breakdown": {
    "skillMatch": 30,
    "experienceMatch": 15,
    "domainMatch": 10,
    "educationMatch": 3,
    "bonusMatch": 8
  },
  "confidence": 0.8,
  "strengths": ["優勢1", "優勢2"],
  "gaps": ["缺口1"],
  "mustHaveMatches": [{"item": "必備條件1", "status": "matched"}],
  "reason": "評估理由說明。"
}`;

    return retryTransient(async () => {
    const completion = await this.client!.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'evaluation_output',
          strict: true,
          schema: EVALUATION_JSON_SCHEMA,
        },
      },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const result = EvaluationOutputSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`[OpenRouterProvider] JSON 結構驗證失敗: ${result.error.issues.map(i => i.message).join(', ')}`);
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
    }, `OpenRouter API 評估 ("${jobTitle}")`);
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
    if (!this.client) {
      throw new Error('[OpenRouterProvider] OPENROUTER_API_KEY 未設定或客戶端初始化失敗。');
    }

    const sanitizedJd = sanitizeJdContent(jobDescription);
    const resume = this.buildResumeSummary();
    let evalSection = '';
    if (evaluationContext) {
      evalSection = `AI 評估結果：優勢【${evaluationContext.strengths?.join(', ')}】，缺口【${evaluationContext.gaps?.join(', ')}】`;
    }

    const systemPrompt = `你是一位求職專家。請根據求職者優勢與 JD 生成客製化自薦信與自我介紹，並【嚴格】輸出 JSON 格式。\n\n【求職者履歷摘要】\n${resume}`;
    const userPrompt = `
【公司】: ${companyName}
【職缺】: ${jobTitle}
【JD】: ${sanitizedJd}
${evalSection}

請輸出以下 JSON 結構：
{
  "coverLetter": "條列式客製化自我推薦信 (約 150-250 字，台灣繁體中文)",
  "optimizedSelfIntro": "精簡自我介紹 (約 100-200 字，台灣繁體中文)"
}`;

    return retryTransient(async () => {
    const completion = await this.client!.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'customization_output',
          strict: true,
          schema: CUSTOMIZATION_JSON_SCHEMA,
        },
      },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const result = CustomizationOutputSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`[OpenRouterProvider] 自薦信 JSON 結構驗證失敗: ${result.error.issues.map(i => i.message).join(', ')}`);
    }

    return {
      coverLetter: result.data.coverLetter,
      optimizedSelfIntro: result.data.optimizedSelfIntro,
    };
    }, `OpenRouter API 生成自薦信 ("${jobTitle}")`);
  }
}
