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
import { retryTransient } from '../retry';
import { EVALUATION_JSON_SCHEMA, CUSTOMIZATION_JSON_SCHEMA } from '../schemas';
import { buildEvaluationPrompt, buildCustomizationPrompt } from '../prompts';

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

  private parseJsonResponse(text: string): any {
    const cleanStr = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleanStr);
  }

  private computeDecision(
    totalScore: number,
    mustHaveMatches: RequirementMatch[]
  ): 'apply' | 'maybe' | 'skip' {
    const criticalMissing = mustHaveMatches.filter(m => m.status === 'missing').length;
    const threshold = config.scoreThreshold;

    if (totalScore >= threshold && criticalMissing === 0) {
      return 'apply';
    }
    if (totalScore >= threshold - 15 && criticalMissing <= 1) {
      return 'maybe';
    }
    if (criticalMissing >= 3) {
      return 'skip';
    }
    if (totalScore >= threshold) {
      return 'maybe';
    }
    return 'skip';
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
    const prompt = buildEvaluationPrompt({ resume, companyName, jobTitle, sanitizedJd });

    return retryTransient(async () => {
      const response = await this.ai!.models.generateContent({
        model: config.aiModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: EVALUATION_JSON_SCHEMA,
        },
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
      const shouldApply = totalScore >= config.scoreThreshold && decision !== 'skip';

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
        coverLetter: data.coverLetter || '',
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
      decision?: 'apply' | 'maybe' | 'skip';
    }
  ): Promise<CustomizationResult> {
    if (!this.ai) {
      throw new Error('[GeminiProvider] Gemini API client is not initialized.');
    }

    const resume = this.buildResumeSummary();
    const sanitizedJd = sanitizeJdContent(jobDescription);
    const prompt = buildCustomizationPrompt({
      resume,
      companyName,
      jobTitle,
      sanitizedJd,
      evaluationContext,
    });

    return retryTransient(async () => {
      const response = await this.ai!.models.generateContent({
        model: config.aiModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: CUSTOMIZATION_JSON_SCHEMA,
        },
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
        // 【註記保留】：暫時註解停用
        // optimizedSelfIntro: result.data.optimizedSelfIntro,
      };
    }, `Gemini API 生成自薦信 ("${jobTitle}")`);
  }
}

export const gemini = new GeminiProvider();
