import { BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import { config } from '../config';
import { launchStealthContext, launchStealthPersistentContext } from '../browser';
import { filter104StorageState } from '../session-state';

export interface ScrapedJob {
  jobId: string;
  title: string;
  company: string;
  url: string;
  platform: string;
}

/**
 * Result of opening an application form without changing any form values or
 * submitting it. This is intentionally separate from `applyToJob` so a
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
   * Persistent BrowserContext with stealth mitigations and saved login session.
   * Used for authenticated operations (Apply form submission).
   */
  protected persistentContext: BrowserContext | null = null;
  /**
   * Ephemeral unauthenticated BrowserContext for public search and JD scraping.
   * Avoids 104 WAF 403 blocks triggered by session cookies in headless mode.
   */
  protected unauthContext: BrowserContext | null = null;
  private unauthCloseHandler: (() => Promise<void>) | null = null;
  private legacyCookiesImported = false;

  public abstract readonly platformName: string;

  /**
   * Initializes or returns the shared stealth persistent context for authenticated actions.
   */
  public async getPersistentContext(): Promise<BrowserContext> {
    if (this.persistentContext) {
      try {
        this.persistentContext.pages();
        return this.persistentContext;
      } catch {
        this.persistentContext = null;
      }
    }

    this.persistentContext = await launchStealthPersistentContext(config.userDataDir, {
      headless: config.headless,
    });

    // Import legacy auth_state.json cookies if present to prime the profile
    if (!this.legacyCookiesImported && fs.existsSync(config.authStatePath)) {
      try {
        const raw = fs.readFileSync(config.authStatePath, 'utf8');
        const state = JSON.parse(raw);
        if (state.cookies && Array.isArray(state.cookies)) {
          const filtered = filter104StorageState(state);
          if (filtered.cookies.length > 0) {
            await this.persistentContext.addCookies(filtered.cookies);
            console.log(`[Platform] Imported ${filtered.cookies.length} session cookies from ${config.authStatePath} into Persistent Profile.`);
          }
        }
      } catch (e: any) {
        console.warn(`[Platform] Notice: Could not import legacy auth_state: ${e?.message || e}`);
      }
      this.legacyCookiesImported = true;
    }

    return this.persistentContext;
  }

  /**
   * Initializes or returns an unauthenticated, clean browser context for public searching and JD scraping.
   * Prevents 104 WAF 403 blocks in headless mode.
   */
  public async getUnauthenticatedContext(): Promise<BrowserContext> {
    if (this.unauthContext) {
      try {
        this.unauthContext.pages();
        return this.unauthContext;
      } catch {
        this.unauthContext = null;
        this.unauthCloseHandler = null;
      }
    }

    const { context, close } = await launchStealthContext({
      headless: config.headless,
    });
    this.unauthContext = context;
    this.unauthCloseHandler = close;
    return context;
  }

  public async getSearchPage(): Promise<Page> {
    const context = await this.getUnauthenticatedContext();
    return context.newPage();
  }

  public async getDetailPage(): Promise<Page> {
    const context = await this.getUnauthenticatedContext();
    return context.newPage();
  }

  public async getApplyPage(): Promise<Page> {
    const context = await this.getPersistentContext();
    return context.newPage();
  }

  public async closePage(page: Page): Promise<void> {
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch {}
  }

  public async closeBrowsers(): Promise<void> {
    if (this.unauthCloseHandler) {
      try {
        await this.unauthCloseHandler();
      } catch {}
      this.unauthContext = null;
      this.unauthCloseHandler = null;
    } else if (this.unauthContext) {
      try {
        await this.unauthContext.close();
      } catch {}
      this.unauthContext = null;
    }

    if (this.persistentContext) {
      try {
        await this.persistentContext.close();
      } catch {}
      this.persistentContext = null;
    }
  }

  public abstract searchJobs(
    page: Page,
    keyword: string,
    pageNum?: number,
    options?: { order?: number; isnew?: number }
  ): Promise<ScrapedJob[]>;
  public abstract getJobDescription(page: Page, jobUrl: string): Promise<{ jdText: string; location: string }>;

  /**
   * Opens and inspects the application form without checking boxes, filling
   * text, or clicking its final submit control.
   */
  public abstract preflightApplication(
    jobId: string,
    options?: ApplicationPreflightOptions
  ): Promise<ApplicationPreflightResult>;

  /** Performs a real submission. Never call this from a dry-run. */
  public abstract applyToJob(jobId: string, coverLetter: string): Promise<boolean>;
  public abstract verifyLogin(): Promise<boolean>;
}
