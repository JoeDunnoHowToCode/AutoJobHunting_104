import { config } from '../config';
import { LLMProvider } from './types';
import { GeminiProvider } from './providers/gemini';
import { OpenAIProvider } from './providers/openai';
import { OpenRouterProvider } from './providers/openrouter';
import { OllamaProvider } from './providers/ollama';

export class LLMFactory {
  public static createProvider(providerName: 'gemini' | 'openai' | 'openrouter' | 'ollama'): LLMProvider {
    switch (providerName) {
      case 'gemini':
        return new GeminiProvider();
      case 'openai':
        return new OpenAIProvider();
      case 'openrouter':
        return new OpenRouterProvider();
      case 'ollama':
        return new OllamaProvider();
      default:
        console.warn(`[LLMFactory] Unknown provider '${providerName}', falling back to GeminiProvider.`);
        return new GeminiProvider();
    }
  }

  public static getProvider(): LLMProvider {
    return this.createProvider(config.aiProvider);
  }
}
