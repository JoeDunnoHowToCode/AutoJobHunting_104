import OpenAI from 'openai';
import { LLMProvider } from '../types';
import { config } from '../../config';
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

export interface OpenAIProviderOptions {
  provider: 'openai' | 'openrouter' | 'ollama';
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI | null = null;
  private providerName: string;
  private model: string;

  constructor(options: OpenAIProviderOptions) {
    this.providerName = options.provider;
    this.model = options.model || config.aiModel;

    let apiKey = options.apiKey;
    let baseURL = options.baseURL;
    let defaultHeaders: Record<string, string> | undefined = undefined;

    if (this.providerName === 'openai') {
      apiKey = apiKey || config.openaiApiKey;
      if (!apiKey) {
        console.warn('[OpenAIProvider] Warning: OPENAI_API_KEY is not set.');
        return;
      }
    } else if (this.providerName === 'openrouter') {
      apiKey = apiKey || config.openrouterApiKey;
      baseURL = baseURL || 'https://openrouter.ai/api/v1';
      defaultHeaders = {
        'HTTP-Referer': 'https://github.com/auto-job-hunter',
        'X-Title': 'AutoJobHunter',
      };
      if (!apiKey) {
        console.warn('[OpenAIProvider] Warning: OPENROUTER_API_KEY is not set.');
        return;
      }
    } else if (this.providerName === 'ollama') {
      apiKey = 'ollama'; // Required by OpenAI SDK, ignored by Ollama
      baseURL = baseURL || config.ollamaBaseUrl || 'http://localhost:11434/v1';
    }

    try {
      this.client = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders,
      });
    } catch (err) {
      console.error(`[OpenAIProvider] Failed to initialize ${this.providerName} client:`, err);
    }
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
    if (!this.client) {
      throw new Error(`[OpenAIProvider] ${this.providerName} API Key 未設定或客戶端初始化失敗。`);
    }

    const sanitizedJd = sanitizeJdContent(jobDescription);
    const systemPrompt = `你是一位專業的科技業職涯顧問與人資專家。請根據加權評分量表比對求職者與職缺，並【嚴格】輸出標準 JSON 格式。`;
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

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const result = EvaluationOutputSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`[OpenAIProvider] JSON 結構驗證失敗: ${result.error.issues.map(i => i.message).join(', ')}`);
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
      throw new Error(`[OpenAIProvider] ${this.providerName} API Key 未設定或客戶端初始化失敗。`);
    }

    const sanitizedJd = sanitizeJdContent(jobDescription);
    let evalSection = '';
    if (evaluationContext) {
      evalSection = `AI 評估結果：優勢【${evaluationContext.strengths?.join(', ')}】，缺口【${evaluationContext.gaps?.join(', ')}】`;
    }

    const systemPrompt = `你是一位求職專家。請根據求職者優勢與 JD 生成客製化自薦信與自我介紹，並【嚴格】輸出 JSON 格式。`;
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

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    const result = CustomizationOutputSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(`[OpenAIProvider] 自薦信 JSON 結構驗證失敗: ${result.error.issues.map(i => i.message).join(', ')}`);
    }

    return {
      coverLetter: result.data.coverLetter,
      optimizedSelfIntro: result.data.optimizedSelfIntro,
    };
  }
}
