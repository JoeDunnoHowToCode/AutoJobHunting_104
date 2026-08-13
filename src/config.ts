import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file
dotenv.config();

export interface Config {
  geminiApiKey: string;
  openaiApiKey: string;
  openrouterApiKey: string;
  ollamaBaseUrl: string;
  aiProvider: 'gemini' | 'openai' | 'openrouter' | 'ollama';
  aiModel: string;
  scoreThreshold: number;
  resumePath: string;
  authStatePath: string;
  dbPath: string;
  applyLimitPerRun: number;
  headless: boolean;
  blacklistKeywords: string[];
  telegramBotToken: string;
  telegramChatId: string;
  notionApiToken: string;
  notionDatabaseId: string;
  areas: string[];
}

const rootDir = path.resolve(__dirname, '..');
const settingsPath = path.resolve(rootDir, 'settings.json');
let settings: any = {};
try {
  const fs = require('fs');
  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const jsonStr = raw.replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m: string, g: string) => g ? "" : m);
    settings = JSON.parse(jsonStr);
  }
} catch (e) {
  console.warn('Failed to load settings.json, using defaults.');
}

/** Internal safety limits. Keep them out of user settings to avoid unsafe tuning. */
export const pipelineConfig = {
  jdConcurrency: 1,
  aiConcurrency: 2,
  maxApplyQueueSize: 5,
  resumeApplyQueueSize: 2,
  maxInFlightJobs: 8,
} as const;

export const config: Config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  aiProvider: settings.aiProvider || 'gemini',
  aiModel: settings.aiModel || 'gemini-flash-lite-latest',
  scoreThreshold: settings.scoreThreshold ?? 65,
  resumePath: path.resolve(rootDir, 'resume.json'),
  authStatePath: path.resolve(rootDir, 'auth_state.json'),
  dbPath: path.resolve(rootDir, 'applyRecord.json'),
  applyLimitPerRun: settings.applyLimitPerRun ?? 10,
  headless: settings.headless ?? true,
  blacklistKeywords: settings.blacklistKeywords || [],
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notionApiToken: process.env.NOTION_API_TOKEN || '',
  notionDatabaseId: process.env.NOTION_DATABASE_ID || '',
  areas: settings.areas || []
};
