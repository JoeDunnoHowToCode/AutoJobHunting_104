import { config } from '../config';
import { LLMProvider } from './types';
import { gemini } from '../gemini';
import { OpenAIProvider } from './providers/openai';

export class LLMFactory {
  public static createProvider(providerName: 'gemini' | 'openai' | 'openrouter' | 'ollama'): LLMProvider {
    switch (providerName) {
      case 'gemini':
        return gemini;
      case 'openai':
        return new OpenAIProvider({ provider: 'openai' });
      case 'openrouter':
        return new OpenAIProvider({ provider: 'openrouter' });
      case 'ollama':
        return new OpenAIProvider({ provider: 'ollama' });
      default:
        console.warn(`[LLMFactory] Unknown provider '${providerName}', falling back to Gemini.`);
        return gemini;
    }
  }

  public static getProvider(): LLMProvider {
    return this.createProvider(config.aiProvider);
  }
}
