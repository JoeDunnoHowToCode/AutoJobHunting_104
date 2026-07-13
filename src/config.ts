import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file
dotenv.config();

export interface Config {
  geminiApiKey: string;
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
}

const rootDir = path.resolve(__dirname, '..');
const settingsPath = path.resolve(rootDir, 'settings.json');
let settings: any = {};
try {
  const fs = require('fs');
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  }
} catch (e) {
  console.warn('Failed to load settings.json, using defaults.');
}

export const config: Config = {
  geminiApiKey: process.env.GEMINI_API_KEY || '',
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
  notionDatabaseId: process.env.NOTION_DATABASE_ID || ''
};
