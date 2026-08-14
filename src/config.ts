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
  userDataDir: string;
  dbPath: string;
  applyLimitPerRun: number;
  /** Used only by non-104 auxiliary tools; 104 browser workflows are always visible. */
  headless: boolean;
  /** Use the installed stable Chrome by default; set AUTOJOB_BROWSER_CHANNEL=playwright only for local diagnostics. */
  browserChannel?: 'chrome';
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

function parseBooleanEnvironment(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  console.warn('AUTOJOB_HEADLESS must be "true" or "false"; ignoring invalid value.');
  return undefined;
}

const environmentHeadless = parseBooleanEnvironment(process.env.AUTOJOB_HEADLESS);

function resolveBrowserChannel(value: string | undefined): 'chrome' | undefined {
  // 104 returned a bare 403 for the bundled Chromium while the same machine's
  // normal Chrome could read the public job page. Use Playwright's supported
  // Chrome channel rather than altering browser fingerprints or headers.
  if (value === undefined || value === '' || value === 'chrome') return 'chrome';
  if (value === 'playwright') return undefined;
  console.warn('AUTOJOB_BROWSER_CHANNEL must be "chrome" or "playwright"; using Chrome.');
  return 'chrome';
}

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
  userDataDir: path.resolve(rootDir, '.chrome-profile'),
  dbPath: path.resolve(rootDir, 'applyRecord.json'),
  applyLimitPerRun: settings.applyLimitPerRun ?? 10,
  // Intended for one-off, visible manual validation without modifying a
  // user's ignored settings.json. This does not attempt to alter browser
  // fingerprinting or bypass platform restrictions.
  headless: environmentHeadless ?? settings.headless ?? true,
  browserChannel: resolveBrowserChannel(process.env.AUTOJOB_BROWSER_CHANNEL),
  blacklistKeywords: settings.blacklistKeywords || [],
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  notionApiToken: process.env.NOTION_API_TOKEN || '',
  notionDatabaseId: process.env.NOTION_DATABASE_ID || '',
  areas: settings.areas || []
};
