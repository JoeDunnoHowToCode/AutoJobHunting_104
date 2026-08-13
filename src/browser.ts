import { Browser, chromium } from 'playwright';
import { config } from './config';

export async function launchConfiguredBrowser(options: { headless?: boolean } = {}): Promise<Browser> {
  const headless = options.headless ?? config.headless;
  const browser = await chromium.launch({
    headless,
    ...(config.browserChannel ? { channel: config.browserChannel } : {}),
  });
  console.log(`[Browser] ${config.browserChannel ?? 'Playwright Chromium'} | headless=${headless}`);
  return browser;
}
