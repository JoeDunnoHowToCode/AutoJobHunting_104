import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import { config } from '../config';

export interface ScrapedJob {
  jobId: string;
  title: string;
  company: string;
  url: string;
  platform: string;
}

export abstract class JobPlatform {
  protected searchContext: BrowserContext | null = null;
  protected applyContext: BrowserContext | null = null;

  public abstract readonly platformName: string;

  public async getSearchPage(): Promise<Page> {
    if (this.searchContext) {
      try {
        // Reuse existing context, just return a new page
        return await this.searchContext.newPage();
      } catch (e) {
        // Context is dead, recreate
        this.searchContext = null;
      }
    }

    const browser = await chromium.launch({ headless: config.headless });

    this.searchContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei'
    });

    return await this.searchContext.newPage();
  }

  public async getDetailPage(): Promise<Page> {
    return await this.getSearchPage();
  }

  public async closePage(page: Page): Promise<void> {
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch (e) {}
  }

  public async getApplyPage(): Promise<Page> {
    if (this.applyContext) {
      try {
        // Reuse existing context, just return a new page
        return await this.applyContext.newPage();
      } catch (e) {
        // Context is dead, recreate
        this.applyContext = null;
      }
    }

    const browser = await chromium.launch({ headless: config.headless });
    
    const contextOptions: any = {
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei'
    };

    if (fs.existsSync(config.authStatePath)) {
      console.log(`Loading session from ${config.authStatePath} for application context...`);
      contextOptions.storageState = config.authStatePath;
    } else {
      console.warn(`Warning: ${config.authStatePath} not found for application context.`);
    }

    this.applyContext = await browser.newContext(contextOptions);
    return await this.applyContext.newPage();
  }

  public async closeBrowsers(): Promise<void> {
    if (this.searchContext) {
      await this.searchContext.browser()?.close();
      this.searchContext = null;
    }
    if (this.applyContext) {
      await this.applyContext.browser()?.close();
      this.applyContext = null;
    }
  }

  public abstract searchJobs(page: Page, keyword: string, pageNum?: number): Promise<ScrapedJob[]>;
  public abstract getJobDescription(page: Page, jobUrl: string): Promise<{ jdText: string, location: string }>;
  public abstract applyToJob(jobId: string, coverLetter: string): Promise<boolean>;
  public abstract verifyLogin(): Promise<boolean>;
}
