import { EvaluationResult, CustomizationResult } from '../types';

export interface LLMProvider {
  evaluateJob(
    jobTitle: string,
    companyName: string,
    jobDescription: string
  ): Promise<EvaluationResult>;

  generateCustomizedContent(
    jobTitle: string,
    companyName: string,
    jobDescription: string,
    evaluationContext?: {
      strengths?: string[];
      gaps?: string[];
      decision?: 'APPLY' | 'MAYBE' | 'SKIP';
    }
  ): Promise<CustomizationResult>;
}
