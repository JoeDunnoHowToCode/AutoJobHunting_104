import { z } from 'zod';

// --- Requirement Match for Hard Requirement Analysis ---

export interface RequirementMatch {
  item: string;
  status: 'matched' | 'partial' | 'missing';
}

// --- Scoring Breakdown ---

export interface ScoreBreakdown {
  skillMatch: number;       // 0-40
  experienceMatch: number;  // 0-25
  domainMatch: number;      // 0-15
  educationMatch: number;   // 0-5
  bonusMatch: number;       // 0-15
}

// --- Full Evaluation Result (new, richer interface) ---

export interface JobEvaluationResult {
  totalScore: number;
  breakdown: ScoreBreakdown;
  confidence: number;  // 0.0 - 1.0
  decision: 'APPLY' | 'MAYBE' | 'SKIP';
  strengths: string[];
  gaps: string[];
  mustHaveMatches: RequirementMatch[];
  reason: string;
  shouldApply: boolean;
}

// --- Backward-compatible Evaluation Result ---

export interface EvaluationResult {
  score: number;        // Suitability score from 0 to 100
  reason: string;       // Reason for this score (pros, cons, alignment)
  shouldApply: boolean; // Whether the score meets the threshold
  // New fields (available when using upgraded evaluation)
  breakdown?: ScoreBreakdown;
  confidence?: number;
  decision?: 'APPLY' | 'MAYBE' | 'SKIP';
  strengths?: string[];
  gaps?: string[];
  mustHaveMatches?: RequirementMatch[];
}

// --- Customization Result ---

export interface CustomizationResult {
  coverLetter: string;  // Self-recommendation letter (自我推薦信), target ~200 chars
  optimizedSelfIntro: string; // Tailored self-introduction (自我介紹) for 104 resume
}

// --- Zod Schemas for LLM Output Validation ---

export const RequirementMatchSchema = z.object({
  item: z.string(),
  status: z.enum(['matched', 'partial', 'missing']),
});

export const EvaluationOutputSchema = z.object({
  breakdown: z.object({
    skillMatch: z.number().min(0).max(40),
    experienceMatch: z.number().min(0).max(25),
    domainMatch: z.number().min(0).max(15),
    educationMatch: z.number().min(0).max(5),
    bonusMatch: z.number().min(0).max(15),
  }),
  confidence: z.number().min(0).max(1),
  strengths: z.array(z.string()).min(1).max(5),
  gaps: z.array(z.string()).max(5),
  mustHaveMatches: z.array(RequirementMatchSchema),
  reason: z.string().min(1),
});

export const CustomizationOutputSchema = z.object({
  coverLetter: z.string().min(10),
  optimizedSelfIntro: z.string().min(10),
});

export type EvaluationOutput = z.infer<typeof EvaluationOutputSchema>;
export type CustomizationOutput = z.infer<typeof CustomizationOutputSchema>;
