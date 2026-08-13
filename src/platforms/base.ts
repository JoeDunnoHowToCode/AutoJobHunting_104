import { BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import { config } from '../config';
import { launchConfiguredBrowser } from '../browser';

export interface ScrapedJob {
  jobId: string;
  title: string;
  company: string;
  url: string;
  platform: string;
}

/**
 * Result of opening an application form without changing any form values or
 * submitting it.  This is intentionally separate from `applyToJob` so a
 * preview path cannot accidentally reach the final-submit implementation.
 */
export type ApplicationPreflightStatus =
  | 'ready_for_review'
  | 'login_required'
  | 'already_applied'
  | 'job_unavailable'
  | 'form_unavailable'
  | 'platform_limited'
  | 'error';

export interface ApplicationPreflightResult {
  status: ApplicationPreflightStatus;
  message: string;
  form?: {
    textareaFound: boolean;
    textareaVisible: boolean;
    textareaEnabled: boolean;
    textareaMaxLength: string | null;
    submitButtonFound: boolean;
    submitButtonVisible: boolean;
    submitButtonEnabled: boolean;
    visibleCheckboxCount: number;
    uncheckedCheckboxCount: number;
  };
}

export interface ApplicationPreflightOptions {
  /** Keep a visible form open for an explicit human inspection, then close it. */
  pauseBeforeClose?: boolean;
}

export abstract class JobPlatform {
  /**
   * 104 serves public job discovery and authenticated application pages through
   * different flows. Keep the contexts explicit: public search/JD requests must
   * not accidentally inherit account cookies, while all authenticated pages
   * share one cookie jar for login verification and application handling.
   */
  protected publicContext: BrowserContext | null = null;
  protected authenticatedContext: BrowserContext | null = null;

  public abstract readonly platformName: string;

  private async launch104Browser() {
    // 104 returns HTTP 403 for a JD that is readable in the same browser when
    // it runs headful. This is a verified platform compatibility requirement,
    // not fingerprint manipulation: the 104 workflow always remains visible.
    return launchConfiguredBrowser({ headless: false });
  }

  private async getPublicPage(): Promise<Page> {
    if (this.publicContext) {
      try {
        return await this.publicContext.newPage();
      } catch (e) {
        this.publicContext = null;
      }
    }

    const browser = await this.launch104Browser();
    this.publicContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
    });
    console.log('Using isolated public 104 browser context for search and JD requests.');
    return await this.publicContext.newPage();
  }

  private async getAuthenticatedPage(): Promise<Page> {
    if (this.authenticatedContext) {
      try {
        return await this.authenticatedContext.newPage();
      } catch (e) {
        this.authenticatedContext = null;
      }
    }

    if (!fs.existsSync(config.authStatePath)) {
      throw new Error(`找不到登入 Session 檔案: ${config.authStatePath}；請先執行 npm run login。`);
    }

    const browser = await this.launch104Browser();
    this.authenticatedContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      storageState: config.authStatePath,
    });
    console.log(`Loading session from ${config.authStatePath} for authenticated 104 pages...`);
    return await this.authenticatedContext.newPage();
  }

  public async getSearchPage(): Promise<Page> {
    return this.getPublicPage();
  }

  public async getDetailPage(): Promise<Page> {
    return this.getPublicPage();
  }

  public async closePage(page: Page): Promise<void> {
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch (e) {}
  }

  public async getApplyPage(): Promise<Page> {
    return this.getAuthenticatedPage();
  }

  public async closeBrowsers(): Promise<void> {
    if (this.publicContext) {
      await this.publicContext.browser()?.close();
      this.publicContext = null;
    }
    if (this.authenticatedContext) {
      await this.authenticatedContext.browser()?.close();
      this.authenticatedContext = null;
    }
  }

  public abstract searchJobs(page: Page, keyword: string, pageNum?: number): Promise<ScrapedJob[]>;
  public abstract getJobDescription(page: Page, jobUrl: string): Promise<{ jdText: string, location: string }>;

  /**
   * Opens and inspects the application form without checking boxes, filling
   * text, or clicking its final submit control.
   */
  public abstract preflightApplication(
    jobId: string,
    options?: ApplicationPreflightOptions,
  ): Promise<ApplicationPreflightResult>;

  /** Performs a real submission. Never call this from a dry-run. */
  public abstract applyToJob(jobId: string, coverLetter: string): Promise<boolean>;
  public abstract verifyLogin(): Promise<boolean>;
}
