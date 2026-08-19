import { chromium, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { config } from './config';

/**
 * Automatically clean up any stale Chrome Singleton Lock files in the profile directory.
 * Prevents "Target closed" or "EBUSY: resource busy or locked" crashes on restarts.
 */
export function cleanSingletonLocks(userDataDir: string): void {
  try {
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const file of lockFiles) {
      const lockPath = path.join(userDataDir, file);
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Ignore if file cannot be unlinked
        }
      }
    }

    // Reset crash status to prevent "Restore Pages" prompt
    const checkPrefs = ['Preferences', path.join('Default', 'Preferences')];
    for (const p of checkPrefs) {
      const prefsPath = path.join(userDataDir, p);
      if (fs.existsSync(prefsPath)) {
        try {
          const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
          if (prefs?.profile && (prefs.profile.exit_type !== 'Normal' || prefs.profile.exited_cleanly !== true)) {
            prefs.profile.exit_type = 'Normal';
            prefs.profile.exited_cleanly = true;
            fs.writeFileSync(prefsPath, JSON.stringify(prefs));
          }
        } catch (e) {}
      }
    }
  } catch {
    // Ignore cleanup failures
  }
}

/**
 * Launches a hardened, persistent Chrome browser context with anti-bot detection evasions.
 * Uses native Playwright capabilities without fragile 3rd party plugins.
 */
export async function launchStealthPersistentContext(
  customProfilePath?: string,
  options: { headless?: boolean } = {}
): Promise<BrowserContext> {
  const userDataDir = customProfilePath || config.userDataDir;
  const headless = options.headless ?? config.headless;

  // 1. Clean stale singleton locks
  cleanSingletonLocks(userDataDir);

  const baseArgs = [
    '--test-type',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disk-cache-size=104857600', // 100MB cache limit
    '--media-cache-size=52428800', // 50MB media cache limit
    '--disable-gpu-shader-disk-cache',
    '--disable-component-update',
    '--window-size=1440,900',
    '--lang=zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  ];

  if (headless) {
    baseArgs.push('--headless=new');
  }

  const launchOptions: any = {
    headless,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    args: baseArgs,
    chromiumSandbox: true,
    ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'],
  };

  let context: BrowserContext;
  const preferredChannel = config.browserChannel || 'chrome';

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: preferredChannel,
    });
    console.log(`[Browser] Persistent Context | Channel: ${preferredChannel} | Headless: ${headless}`);
  } catch (err: any) {
    console.warn(`[Browser] Failed to launch with channel "${preferredChannel}", falling back to bundled Chromium: ${err?.message || err}`);
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    console.log(`[Browser] Persistent Context | Channel: bundled chromium | Headless: ${headless}`);
  }

  // 2. Erase automation fingerprints via init script on every page
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      if (navigator.userAgent.includes('HeadlessChrome')) {
        const cleanUa = navigator.userAgent.replace('HeadlessChrome', 'Chrome');
        Object.defineProperty(navigator, 'userAgent', {
          get: () => cleanUa,
        });
      }
    } catch {}
  });

  // 3. Graceful shutdown handler
  const cleanup = async () => {
    try {
      await context.close();
    } catch {}
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  return context;
}

/**
 * Launches an ephemeral, unauthenticated BrowserContext for public search and scraping.
 * Uses a clean temporary profile to prevent 104 WAF 403 blocks in headless mode.
 */
export async function launchStealthContext(
  options: { headless?: boolean } = {}
): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const headless = options.headless ?? config.headless;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-unauth-'));

  const baseArgs = [
    '--test-type',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--disk-cache-size=52428800',
    '--disable-gpu-shader-disk-cache',
    '--disable-component-update',
    '--window-size=1440,900',
    '--lang=zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  ];

  if (headless) {
    baseArgs.push('--headless=new');
  }

  const launchOptions: any = {
    headless,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    args: baseArgs,
    chromiumSandbox: true,
    ignoreDefaultArgs: ['--enable-automation', '--no-sandbox'],
  };

  const preferredChannel = config.browserChannel || 'chrome';
  let context: BrowserContext;

  try {
    context = await chromium.launchPersistentContext(tempDir, {
      ...launchOptions,
      channel: preferredChannel,
    });
    console.log(`[Browser] Unauth Context | Channel: ${preferredChannel} | Headless: ${headless}`);
  } catch (err: any) {
    context = await chromium.launchPersistentContext(tempDir, launchOptions);
    console.log(`[Browser] Unauth Context | Channel: bundled chromium | Headless: ${headless}`);
  }

  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      if (navigator.userAgent.includes('HeadlessChrome')) {
        const cleanUa = navigator.userAgent.replace('HeadlessChrome', 'Chrome');
        Object.defineProperty(navigator, 'userAgent', {
          get: () => cleanUa,
        });
      }
    } catch {}
  });

  return {
    context,
    close: async () => {
      try {
        await context.close();
      } catch {}
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

/** Legacy helper for backward compatibility */
export async function launchConfiguredBrowser(options: { headless?: boolean } = {}): Promise<Browser> {
  const headless = options.headless ?? config.headless;
  const browser = await chromium.launch({
    headless,
    ...(config.browserChannel ? { channel: config.browserChannel } : {}),
  });
  console.log(`[Browser] ${config.browserChannel ?? 'Playwright Chromium'} | headless=${headless}`);
  return browser;
}
