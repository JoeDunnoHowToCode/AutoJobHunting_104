/**
 * JSON Schema definitions for LLM structured output enforcement.
 * Used by Gemini (responseSchema) and OpenAI-compatible providers (json_schema response_format).
 */

/** Schema for evaluateJob output - enforces enum constraint on mustHaveMatches.status */
export const EVALUATION_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    breakdown: {
      type: 'object' as const,
      properties: {
        skillMatch:      { type: 'number' as const },
        experienceMatch: { type: 'number' as const },
        domainMatch:     { type: 'number' as const },
        educationMatch:  { type: 'number' as const },
        bonusMatch:      { type: 'number' as const },
      },
      required: ['skillMatch', 'experienceMatch', 'domainMatch', 'educationMatch', 'bonusMatch'] as const,
      additionalProperties: false,
    },
    confidence: { type: 'number' as const },
    strengths:  { type: 'array' as const, items: { type: 'string' as const } },
    gaps:       { type: 'array' as const, items: { type: 'string' as const } },
    mustHaveMatches: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          item:   { type: 'string' as const },
          status: { type: 'string' as const, enum: ['matched', 'partial', 'missing'] },
        },
        required: ['item', 'status'] as const,
        additionalProperties: false,
      },
    },
    reason: { type: 'string' as const },
  },
  required: ['breakdown', 'confidence', 'strengths', 'gaps', 'mustHaveMatches', 'reason'] as const,
  additionalProperties: false,
};

/** Schema for generateCustomizedContent output */
export const CUSTOMIZATION_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    coverLetter:        { type: 'string' as const },
    // 【註記保留】：104 投遞目前僅填寫自薦信，暫時註解履歷自我介紹欄位，保留未來線上履歷編輯功能使用
    // optimizedSelfIntro: { type: 'string' as const },
  },
  required: ['coverLetter'] as const,
  additionalProperties: false,
};
