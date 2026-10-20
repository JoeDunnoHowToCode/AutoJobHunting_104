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
 * Launch options shared by both 104 contexts.
 *
 * Deliberately plain: Playwright's own defaults plus locale, timezone and window
 * size. No spoofed User-Agent, no `navigator.webdriver` override and no flags
 * that hide automation. If 104 refuses this browser, the run stops (see
 * classify104Navigation) — it must not be "fixed" by disguising the browser.
 */
function buildLaunchOptions(headless: boolean, diskCacheBytes: number) {
  // Headless Chrome is Playwright's own `--headless=new` mode; no extra flag needed.
  return {
    headless,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    args: [
      '--disable-dev-shm-usage',
      `--disk-cache-size=${diskCacheBytes}`,
      '--disable-gpu-shader-disk-cache',
      '--disable-component-update',
      '--window-size=1440,900',
      '--lang=zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    ],
    chromiumSandbox: true,
  };
}

/**
 * Launches a persistent Chrome context that keeps the 104 login profile.
 */
export async function launchPersistentBrowserContext(
  customProfilePath?: string,
  options: { headless?: boolean } = {}
): Promise<BrowserContext> {
  const userDataDir = customProfilePath || config.userDataDir;
  const headless = options.headless ?? config.headless;

  // 1. Clean stale singleton locks
  cleanSingletonLocks(userDataDir);

  const launchOptions = buildLaunchOptions(headless, 104857600); // 100MB cache limit
  launchOptions.args.push('--media-cache-size=52428800'); // 50MB media cache limit

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

  // 2. Graceful shutdown handler
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
 * Uses a clean temporary profile so session cookies never reach the public pages.
 */
export async function launchEphemeralBrowserContext(
  options: { headless?: boolean } = {}
): Promise<{ context: BrowserContext; close: () => Promise<void> }> {
  const headless = options.headless ?? config.headless;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'autojob-unauth-'));

  const launchOptions = buildLaunchOptions(headless, 52428800);

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
