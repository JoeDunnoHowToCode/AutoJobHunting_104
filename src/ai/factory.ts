import { config } from '../config';
import { LLMProvider } from './types';
import { gemini } from '../gemini';

export class LLMFactory {
  public static getProvider(): LLMProvider {
    switch (config.aiProvider) {
      case 'gemini':
        return gemini;
      // Additional providers (openai, openrouter, ollama) can be plugged in here easily
      default:
        console.warn(`[LLMFactory] Unknown provider '${config.aiProvider}', falling back to Gemini.`);
        return gemini;
    }
  }
}
