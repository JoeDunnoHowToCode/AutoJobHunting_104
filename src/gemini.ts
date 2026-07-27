import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import { config } from './config';

export interface EvaluationResult {
  score: number;        // Suitability score from 0 to 100
  reason: string;       // Reason for this score (pros, cons, alignment)
  shouldApply: boolean; // Whether the score meets the threshold
}

export interface CustomizationResult {
  coverLetter: string;  // Self-recommendation letter (自我推薦信), target ~200 chars
  optimizedSelfIntro: string; // Tailored self-introduction (自我介紹) for 104 resume
}

class GeminiService {
  private ai: GoogleGenAI | null = null;

  constructor() {
    this.init();
  }

  private init() {
    if (!config.geminiApiKey) {
      console.warn('Warning: GEMINI_API_KEY is not set in environment. Gemini services will fail.');
      return;
    }
    try {
      this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    } catch (error) {
      console.error('Failed to initialize GoogleGenAI client:', error);
    }
  }

  private getResumeText(): string {
    if (!fs.existsSync(config.resumePath)) {
      console.warn(`Warning: Resume file not found at ${config.resumePath}.`);
      return '';
    }
    // Read JSON and format as readable string for LLM
    try {
      const resumeJson = JSON.parse(fs.readFileSync(config.resumePath, 'utf8'));
      return JSON.stringify(resumeJson, null, 2);
    } catch (e) {
      return fs.readFileSync(config.resumePath, 'utf8');
    }
  }

  /**
   * Evaluates a job description (JD) against the user's resume and returns a score and reason.
   */
  public async evaluateJob(
    jobTitle: string,
    companyName: string,
    jobDescription: string
  ): Promise<EvaluationResult> {
    if (!this.ai) {
      throw new Error('Gemini API client is not initialized.');
    }

    const resume = this.getResumeText();
    const prompt = `你是一位專業的科技業職涯顧問與人資專家。請客觀比對以下「求職者履歷(JSON格式)」與「職缺 JD（工作說明書）」，評估其契合度。

【求職者履歷】
${resume}

【目標公司】
${companyName}

【目標職缺】
${jobTitle}

【職缺 JD 內容】
${jobDescription}

請客觀評估，並【嚴格】輸出以下 JSON 格式：
{
  "score": 85, // 契合度分數，範圍 0-100 (整數)。請嚴格根據技能重合度與經驗要求評分。
  "reason": "寫下具體的分析原因。列出 1. 優勢重疊；2. 弱勢缺失，語氣需專業客觀。"
}

注意：
1. 請只回傳 JSON 字串，不要包含任何 \`\`\`json 或 \`\`\` 標記。`;

    let retries = 3;
    while (retries > 0) {
      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-flash-lite-latest',
          contents: prompt,
        });

        const text = response.text?.trim() || '';
        const cleanJsonStr = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(cleanJsonStr);

        const score = typeof parsed.score === 'number' ? parsed.score : 0;
        const shouldApply = score >= config.scoreThreshold;

        return {
          score,
          reason: parsed.reason || '無分析原因',
          shouldApply
        };
      } catch (error) {
        retries--;
        console.error(`Gemini API 評估失敗 ("${jobTitle}")，剩餘重試次數: ${retries}`, error);
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
      }
    }
    throw new Error('Unreachable code');
  }

  /**
   * Generates a customized cover letter and tailored self-intro based on the JD.
   */
  public async generateCustomizedContent(
    jobTitle: string,
    companyName: string,
    jobDescription: string
  ): Promise<CustomizationResult> {
    if (!this.ai) {
      throw new Error('Gemini API client is not initialized.');
    }

    const resume = this.getResumeText();
    const prompt = `你是一位專業且極具說服力的求職者。請根據以下「求職者履歷」與「職缺 JD」，生成一份客製化的「自我推薦信」與「優化履歷自我介紹」。

【求職者履歷】
${resume}

【目標公司】
${companyName}

【目標職缺】
${jobTitle}

【職缺 JD 內容】
${jobDescription}

請【嚴格】輸出以下 JSON 格式：
{
  "coverLetter": "填寫客製化的自我推薦信。請使用精簡、條列式的方法直接點出自己的核心優勢，不需廢話，符合現代 HR 的閱讀習慣（約 150-250 字）。請使用繁體中文（台灣）。",
  "optimizedSelfIntro": "填寫精簡且高度契合此職缺的自我介紹（約 100-200 字）。請使用繁體中文（台灣）。"
}

注意：
1. 請只回傳 JSON 字串，不要包含任何 \`\`\`json 或 \`\`\` 標記。
2. 務必使用繁體中文。`;

    let retries = 3;
    while (retries > 0) {
      try {
        const response = await this.ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
        });

        const text = response.text?.trim() || '';
        const cleanJsonStr = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(cleanJsonStr);

        return {
          coverLetter: parsed.coverLetter || '您好，我對貴司的職缺非常有興趣，期待有機會與您進一步面談。',
          optimizedSelfIntro: parsed.optimizedSelfIntro || '專業前端與全端工程師，具備豐富的 React 與 Node.js 開發實戰經驗。'
        };
      } catch (error) {
        retries--;
        console.error(`Gemini API 生成自薦信失敗 ("${jobTitle}")，剩餘重試次數: ${retries}`, error);
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    throw new Error('Unreachable code');
  }
}

export const gemini = new GeminiService();
