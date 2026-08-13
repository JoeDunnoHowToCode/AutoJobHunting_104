import { Locator, Page } from 'playwright';
import * as readline from 'readline';
import {
  ApplicationPreflightOptions,
  ApplicationPreflightResult,
  JobPlatform,
  ScrapedJob,
} from './base';
import { config } from '../config';

export type PlatformAccessErrorCode = 'SESSION_EXPIRED' | 'PLATFORM_LIMITED' | 'PAGE_UNRECOGNIZED';
export type PlatformRequestStage = 'login' | 'search' | 'job' | 'application';
export type PlatformAccessClassification =
  | 'authentication_required'
  | 'http_forbidden'
  | 'rate_limited'
  | 'challenge_required'
  | 'service_unavailable'
  | 'navigation_failed'
  | 'page_unrecognized';

/**
 * Safe-to-log navigation metadata. Query strings, response bodies, cookies,
 * and request headers are deliberately excluded.
 */
export interface PlatformNavigationDiagnostic {
  stage: PlatformRequestStage;
  classification: PlatformAccessClassification;
  status?: number;
  path: string;
  elapsedMs?: number;
  markerIds: string[];
}

function safePath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'unknown';
  }
}

function describeDiagnostic(diagnostic: PlatformNavigationDiagnostic): string {
  const fields = [
    `stage=${diagnostic.stage}`,
    `classification=${diagnostic.classification}`,
    `path=${diagnostic.path}`,
    diagnostic.status === undefined ? undefined : `status=${diagnostic.status}`,
    diagnostic.elapsedMs === undefined ? undefined : `elapsedMs=${diagnostic.elapsedMs}`,
    diagnostic.markerIds.length === 0 ? undefined : `markers=${diagnostic.markerIds.join(',')}`,
  ].filter((value): value is string => Boolean(value));
  return `[104 diagnostic] ${fields.join(' ')} `;
}

/** A stop-the-pipeline condition, never something the automation should bypass. */
export class PlatformAccessError extends Error {
  public readonly code: PlatformAccessErrorCode;
  public readonly diagnostic: PlatformNavigationDiagnostic;

  constructor(code: PlatformAccessErrorCode, message: string, diagnostic: PlatformNavigationDiagnostic) {
    super(message);
    this.name = 'PlatformAccessError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

type ApplicationFormErrorCode = 'ALREADY_APPLIED' | 'JOB_UNAVAILABLE' | 'FORM_UNAVAILABLE';

export class ApplicationFormError extends Error {
  public readonly code: ApplicationFormErrorCode;

  constructor(code: ApplicationFormErrorCode, message: string) {
    super(message);
    this.name = 'ApplicationFormError';
    this.code = code;
  }
}

interface ApplicationFormSession {
  sourcePage: Page;
  targetPage: Page;
  popupOpened: boolean;
}

interface FormInspection {
  textarea: Locator | null;
  submitButton: Locator | null;
  result: NonNullable<ApplicationPreflightResult['form']>;
}

const AREA_MAP: Record<string, string> = {
  '台北市': '6001001000',
  '新北市': '6001002000',
  '宜蘭縣': '6001003000',
  '基隆市': '6001004000',
  '桃園市': '6001005000',
  '新竹縣市': '6001006000',
  '新竹縣': '6001006000',
  '新竹市': '6001006000',
  '苗栗縣': '6001007000',
  '台中市': '6001008000',
  '彰化縣': '6001010000',
  '南投縣': '6001011000',
  '雲林縣': '6001012000',
  '嘉義縣市': '6001013000',
  '嘉義縣': '6001013000',
  '嘉義市': '6001013000',
  '台南市': '6001014000',
  '高雄市': '6001016000',
  '屏東縣': '6001018000',
  '台東縣': '6001019000',
  '花蓮縣': '6001020000',
  '澎湖縣': '6001021000',
  '金門縣': '6001022000',
  '連江縣': '6001023000'
};

const LOGIN_URL_MARKERS = ['signin.104.com.tw', 'login.104.com.tw'];
const LOGIN_TEXT_MARKERS = ['Log in to 104', '登入/註冊', 'Not a member yet'];
const LIMIT_TEXT_MARKERS: Array<{ id: string; text: string; classification: PlatformAccessClassification }> = [
  { id: 'rate_limit', text: '操作過於頻繁', classification: 'rate_limited' },
  { id: 'rate_limit', text: '存取過於頻繁', classification: 'rate_limited' },
  { id: 'rate_limit', text: 'Too Many Requests', classification: 'rate_limited' },
  { id: 'challenge', text: '請完成驗證', classification: 'challenge_required' },
  { id: 'challenge', text: '安全驗證', classification: 'challenge_required' },
  { id: 'challenge', text: '請輸入驗證碼', classification: 'challenge_required' },
  { id: 'challenge', text: '圖形驗證', classification: 'challenge_required' },
  { id: 'challenge', text: '人機驗證', classification: 'challenge_required' },
  { id: 'challenge', text: 'reCAPTCHA', classification: 'challenge_required' },
  { id: 'access_denied', text: 'Access Denied', classification: 'http_forbidden' },
  { id: 'service_unavailable', text: '服務暫時無法使用', classification: 'service_unavailable' },
];
const JOB_UNAVAILABLE_TEXT_MARKERS = ['此職缺已關閉', '職缺已關閉', '已停止徵才', '找不到此職缺'];
const ALREADY_APPLIED_TEXT_MARKERS = ['您已應徵此職缺', '已應徵此職缺', '您已投遞此職缺'];

interface NavigationClassificationInput {
  stage: PlatformRequestStage;
  path: string;
  status?: number;
  elapsedMs?: number;
  markerIds?: string[];
  loginRedirect?: boolean;
  navigationFailed?: boolean;
  expectedPageShape?: boolean;
}

/** Pure classifier: keeps diagnosis testable without sending any network traffic. */
export function classify104Navigation(input: NavigationClassificationInput): PlatformNavigationDiagnostic | null {
  const markerIds = [...new Set(input.markerIds ?? [])];
  let classification: PlatformAccessClassification | null = null;

  if (input.loginRedirect || input.status === 401 || markerIds.includes('login_required')) {
    classification = 'authentication_required';
  } else if (markerIds.includes('challenge')) {
    classification = 'challenge_required';
  } else if (input.status === 429 || markerIds.includes('rate_limit')) {
    classification = 'rate_limited';
  } else if (input.status === 403 || markerIds.includes('access_denied')) {
    classification = 'http_forbidden';
  } else if ((input.status !== undefined && input.status >= 500) || markerIds.includes('service_unavailable')) {
    classification = 'service_unavailable';
  } else if (input.navigationFailed) {
    classification = 'navigation_failed';
  } else if (input.stage === 'job' && input.expectedPageShape === false) {
    classification = 'page_unrecognized';
  }

  return classification === null ? null : {
    stage: input.stage,
    classification,
    status: input.status,
    path: input.path,
    elapsedMs: input.elapsedMs,
    markerIds,
  };
}

export class Platform104 extends JobPlatform {
  public readonly platformName = '104';

  private async getBodyText(page: Page): Promise<string> {
    return page.locator('body').innerText().catch(() => '');
  }

  private toAccessError(diagnostic: PlatformNavigationDiagnostic): PlatformAccessError {
    const code: PlatformAccessErrorCode = diagnostic.classification === 'authentication_required'
      ? 'SESSION_EXPIRED'
      : diagnostic.classification === 'page_unrecognized'
        ? 'PAGE_UNRECOGNIZED'
        : 'PLATFORM_LIMITED';
    const messageByClassification: Record<PlatformAccessClassification, string> = {
      authentication_required: '104 導向登入或登入 Session 已失效。',
      http_forbidden: '104 拒絕存取此頁面（HTTP 403）。',
      rate_limited: '104 顯示請求頻率限制。',
      challenge_required: '104 顯示安全驗證頁面。',
      service_unavailable: '104 服務暫時無法使用。',
      navigation_failed: '104 頁面導覽沒有取得可驗證的主文件回應。',
      page_unrecognized: '104 頁面缺少可辨識的職缺內容結構。',
    };
    return new PlatformAccessError(
      code,
      `${messageByClassification[diagnostic.classification]} ${describeDiagnostic(diagnostic)}`,
      diagnostic,
    );
  }

  private async getAccessIssue(
    page: Page,
    stage: PlatformRequestStage,
    requireAuthenticatedSession: boolean,
    expectedPageShape?: boolean,
  ): Promise<PlatformAccessError | null> {
    const currentUrl = page.url();
    const bodyText = await this.getBodyText(page);
    const markerIds = LIMIT_TEXT_MARKERS
      .filter(marker => bodyText.includes(marker.text))
      .map(marker => marker.id);

    // Public search pages normally include a "登入/註冊" header. Only use text
    // markers as a login signal on a page that is expected to be authenticated.
    if (requireAuthenticatedSession && LOGIN_TEXT_MARKERS.some(marker => bodyText.includes(marker))) {
      markerIds.push('login_required');
    }

    const diagnostic = classify104Navigation({
      stage,
      path: safePath(currentUrl),
      markerIds,
      loginRedirect: LOGIN_URL_MARKERS.some(marker => currentUrl.includes(marker)),
      expectedPageShape,
    });
    return diagnostic ? this.toAccessError(diagnostic) : null;
  }

  private async assertPageAccessible(
    page: Page,
    stage: PlatformRequestStage,
    requireAuthenticatedSession: boolean,
    expectedPageShape?: boolean,
  ): Promise<void> {
    const issue = await this.getAccessIssue(page, stage, requireAuthenticatedSession, expectedPageShape);
    if (issue) throw issue;
  }

  private assertNavigationResponse(
    status: number | undefined,
    stage: PlatformRequestStage,
    page: Page,
    startedAt: number,
  ): void {
    if (stage === 'job' && (status === 404 || status === 410)) {
      throw new ApplicationFormError('JOB_UNAVAILABLE', '104 回傳職缺不存在或已關閉。');
    }

    const diagnostic = classify104Navigation({
      stage,
      status,
      path: safePath(page.url()),
      elapsedMs: Date.now() - startedAt,
      navigationFailed: status === undefined,
    });
    // A 403 for a JD may be a platform-level access restriction, even if a
    // different public job was readable earlier. Stop the complete pipeline
    // on the first such response; never turn a restriction into a scan.
    if (diagnostic) throw this.toAccessError(diagnostic);
    console.log(`[104 navigation] stage=${stage} status=${status} path=${safePath(page.url())} elapsedMs=${Date.now() - startedAt}`);
  }

  private async findFirstVisible(candidates: Locator[]): Promise<Locator | null> {
    for (const candidate of candidates) {
      const count = await candidate.count();
      for (let index = 0; index < count; index++) {
        const item = candidate.nth(index);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    return null;
  }

  private applyButtonCandidates(page: Page): Locator[] {
    return [
      page.locator('[data-v-e3fvojuuftu="apply-button"]'),
      page.locator('.apply-button__button'),
      page.locator('.apply-button'),
      page.getByRole('link', { name: '我要應徵', exact: true }),
      page.getByRole('button', { name: '我要應徵', exact: true }),
      page.getByText('我要應徵', { exact: true }),
    ];
  }

  private textareaCandidates(page: Page): Locator[] {
    return [
      page.locator('textarea[name="recommend"]'),
      page.locator('textarea#recommend'),
      page.locator('textarea[placeholder*="推薦"]'),
      page.locator('textarea'),
    ];
  }

  private submitButtonCandidates(page: Page): Locator[] {
    return [
      page.getByRole('button', { name: '確認應徵', exact: true }),
      page.getByRole('button', { name: '確認送出', exact: true }),
      page.getByRole('button', { name: '送出應徵', exact: true }),
      page.getByText('確認送出', { exact: true }),
      page.getByText('確認應徵', { exact: true }),
    ];
  }

  private async inspectForm(page: Page): Promise<FormInspection> {
    const textarea = await this.findFirstVisible(this.textareaCandidates(page));
    const submitButton = await this.findFirstVisible(this.submitButtonCandidates(page));
    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();
    let visibleCheckboxCount = 0;
    let uncheckedCheckboxCount = 0;

    for (let index = 0; index < checkboxCount; index++) {
      const checkbox = checkboxes.nth(index);
      if (await checkbox.isVisible().catch(() => false)) {
        visibleCheckboxCount++;
        if (!(await checkbox.isChecked().catch(() => false))) uncheckedCheckboxCount++;
      }
    }

    const textareaFound = textarea !== null;
    const submitButtonFound = submitButton !== null;
    const textareaVisible = textareaFound && await textarea!.isVisible().catch(() => false);
    const textareaEnabled = textareaFound && await textarea!.isEnabled().catch(() => false);
    const submitButtonVisible = submitButtonFound && await submitButton!.isVisible().catch(() => false);
    const submitButtonEnabled = submitButtonFound && await submitButton!.isEnabled().catch(() => false);

    return {
      textarea,
      submitButton,
      result: {
        textareaFound,
        textareaVisible,
        textareaEnabled,
        textareaMaxLength: textareaFound ? await textarea!.getAttribute('maxlength') : null,
        submitButtonFound,
        submitButtonVisible,
        submitButtonEnabled,
        visibleCheckboxCount,
        uncheckedCheckboxCount,
      },
    };
  }

  private async closeApplicationForm(session: ApplicationFormSession | null): Promise<void> {
    if (!session) return;
    try {
      if (session.popupOpened && !session.targetPage.isClosed()) await session.targetPage.close();
    } finally {
      if (!session.sourcePage.isClosed()) await session.sourcePage.close();
    }
  }

  private async pauseForHumanReview(): Promise<void> {
    if (!process.stdin.isTTY) {
      console.warn('[Dry-run] --pause-before-close 需要互動式終端機；將直接關閉唯讀表單。');
      return;
    }

    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => {
      terminal.question('[Dry-run] 表單停在送出前。請人工檢查；按 Enter 關閉，不會送出：', () => {
        terminal.close();
        resolve();
      });
    });
  }

  private async openApplicationForm(jobId: string): Promise<ApplicationFormSession> {
    const sourcePage = await this.getApplyPage();
    let targetPage = sourcePage;
    let popupOpened = false;

    try {
      const navigationStartedAt = Date.now();
      const response = await sourcePage.goto(`https://www.104.com.tw/job/${jobId}`, { waitUntil: 'domcontentloaded' });
      this.assertNavigationResponse(response?.status(), 'application', sourcePage, navigationStartedAt);
      await sourcePage.waitForTimeout(2000);
      await this.assertPageAccessible(sourcePage, 'application', true);

      const sourceText = await this.getBodyText(sourcePage);
      if (JOB_UNAVAILABLE_TEXT_MARKERS.some(marker => sourceText.includes(marker))) {
        throw new ApplicationFormError('JOB_UNAVAILABLE', '職缺已關閉或無法開啟應徵表單。');
      }
      if (ALREADY_APPLIED_TEXT_MARKERS.some(marker => sourceText.includes(marker))) {
        throw new ApplicationFormError('ALREADY_APPLIED', '104 顯示此職缺已經投遞。');
      }

      const applyButton = await this.findFirstVisible(this.applyButtonCandidates(sourcePage));
      if (!applyButton) {
        throw new ApplicationFormError('FORM_UNAVAILABLE', '找不到「我要應徵」按鈕；可能是職缺狀態或頁面結構已變更。');
      }

      const popupPromise = sourcePage.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
      await applyButton.click();
      const popup = await popupPromise;

      if (popup) {
        targetPage = popup;
        popupOpened = true;
        await targetPage.waitForLoadState('domcontentloaded');
        await targetPage.waitForTimeout(1500);
      } else {
        // 104 sometimes opens the form in the current page or a modal.
        await sourcePage.waitForTimeout(2500);
      }

      await this.assertPageAccessible(targetPage, 'application', true);
      const targetText = await this.getBodyText(targetPage);
      if (JOB_UNAVAILABLE_TEXT_MARKERS.some(marker => targetText.includes(marker))) {
        throw new ApplicationFormError('JOB_UNAVAILABLE', '104 顯示職缺已關閉。');
      }
      if (ALREADY_APPLIED_TEXT_MARKERS.some(marker => targetText.includes(marker))) {
        throw new ApplicationFormError('ALREADY_APPLIED', '104 顯示此職缺已經投遞。');
      }

      return { sourcePage, targetPage, popupOpened };
    } catch (error) {
      await this.closeApplicationForm({ sourcePage, targetPage, popupOpened });
      throw error;
    }
  }

  public async searchJobs(page: Page, keyword: string, pageNum: number = 1): Promise<ScrapedJob[]> {
    console.log(`Searching for jobs on 104 with keyword: "${keyword}", Page: ${pageNum}...`);
    let searchUrl = `https://www.104.com.tw/jobs/search/?clean=1&ro=0&keyword=${encodeURIComponent(keyword)}&isnew=7&order=12&asc=0&page=${pageNum}`;
    
    if (config.areas && config.areas.length > 0) {
      const areaCodes = config.areas.map(areaName => AREA_MAP[areaName] || '').filter(code => code !== '');
      if (areaCodes.length > 0) {
        searchUrl += `&area=${areaCodes.join(',')}`;
        console.log(`[Search] Applied location filter: ${config.areas.join(', ')} -> ${areaCodes.join(',')}`);
      } else {
        console.warn(`[Warning] No valid area codes found for configured areas: ${config.areas.join(', ')}`);
      }
    }
    
    const navigationStartedAt = Date.now();
    const response = await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    this.assertNavigationResponse(response?.status(), 'search', page, navigationStartedAt);
    
    // Robust 8-second wait to ensure background thread resources finish rendering Vue Virtual Scroller
    await page.waitForTimeout(8000); 
    // The public search page intentionally shows a "登入/註冊" header. It
    // must not be treated as an expired Session because this is a public
    // context by design.
    await this.assertPageAccessible(page, 'search', false);

    const title = await page.title();
    console.log(`[Debug Search] Page Title: "${title}"`);

    // Scroll down multiple times to trigger lazy loading of more jobs
    console.log('Scrolling down to load more job listings...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(1500);
    }

    const jobItems: ScrapedJob[] = [];
    const jobLinks = await page.locator('a[href*="/job/"]').all();
    const processedIds = new Set<string>();

    console.log(`Analyzing ${jobLinks.length} total links to find job cards...`);

    for (const link of jobLinks) {
      try {
        const href = await link.getAttribute('href') || '';
        const text = (await link.innerText()).trim();

        const isAdOrHotJob = href.includes('jobsource=hotjob') || 
                            href.includes('jobsource=AD_') || 
                            href.includes('jobsource=recommend') || 
                            href.includes('jobsource=similar');

        if (href.includes('/job/') && !isAdOrHotJob && text.length > 2 && !text.includes('應徵') && !text.includes('儲存') && !text.includes('分析')) {
          const match = href.match(/\/job\/([a-zA-Z0-9]+)/);
          if (!match) continue;
          const jobId = match[1];

          if (processedIds.has(jobId)) continue;
          processedIds.add(jobId);

          let companyName = '未知企業';
          try {
            const containerHandle = await link.evaluateHandle(el => {
              let current = el.parentElement;
              while (current && current.tagName !== 'BODY') {
                if (
                  current.classList.contains('job-summary') || 
                  current.classList.contains('js-job-item') || 
                  current.classList.contains('job-list-container') ||
                  current.classList.contains('recycle-scroller--item') ||
                  current.tagName === 'ARTICLE'
                ) {
                  return current;
               }
                current = current.parentElement;
              }
              return el.parentElement || el;
            });

            const container = containerHandle.asElement();
            if (container) {
              const compLink = await container.$('a[href*="/company/"]');
              if (compLink) {
                companyName = (await compLink.innerText()).trim();
              }
            }
          } catch (compErr) {
            // Ignore
          }

          const cleanJobId = jobId.split('?')[0];

          jobItems.push({
            jobId: cleanJobId,
            title: text,
            company: companyName,
            url: `https://www.104.com.tw/job/${cleanJobId}`,
            platform: this.platformName
          });
        }
      } catch (err) {
        // Skip malformed
      }
    }

    console.log(`Extracted ${jobItems.length} unique job listings from 104.`);
    return jobItems;
  }

  public async getJobDescription(page: Page, jobUrl: string): Promise<{ jdText: string, location: string }> {
    console.log(`Navigating to job details: ${jobUrl}...`);
    const navigationStartedAt = Date.now();
    const response = await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });
    this.assertNavigationResponse(response?.status(), 'job', page, navigationStartedAt);
    await page.waitForTimeout(2000);

    const pageText = await this.getBodyText(page);
    if (JOB_UNAVAILABLE_TEXT_MARKERS.some(marker => pageText.includes(marker))) {
      throw new ApplicationFormError('JOB_UNAVAILABLE', '職缺已關閉或不存在。');
    }

    const selectors = [
      '.job-description',
      '.job-description-table',
      '.job-requirement'
    ];

    let jdText = '';
    for (const selector of selectors) {
      const element = page.locator(selector).first();
      if (await element.count() > 0) {
        jdText += '\n' + (await element.innerText()).trim() + '\n';
      }
    }

    // Do not send an unknown error page to the LLM. A normal job page must
    // expose one of the expected JD containers.
    await this.assertPageAccessible(page, 'job', false, jdText.trim().length > 0);

    let location = '未知';
    const locSpan = page.locator('.job-address span').first();
    if (await locSpan.count() > 0) {
      location = (await locSpan.innerText()).trim();
    }

    if (!location || location === '未知') {
      const locDiv = page.locator('.job-address').first();
      if (await locDiv.count() > 0) {
        // Evaluate direct text content of span/children inside .job-address to avoid attribute text
        const text = await locDiv.evaluate(el => {
          const span = el.querySelector('span');
          return span ? span.textContent : el.textContent;
        });
        if (text) location = text.trim();
      }
    }

    if (!location || location === '未知') {
      const locMatch = jdText.match(/(?:上班地點|工作地點)[：\s]*([\s\S]*?)(?=管理責任|出差外派|上班時段|休假制度|可上班日|$)/);
      if (locMatch && locMatch[1].trim().length < 100) {
        location = locMatch[1].trim();
      }
    }

    return { jdText, location };
  }

  public async verifyLogin(): Promise<boolean> {
    console.log('正在驗證 104 登入 Session 是否有效...');
    let page: Page | null = null;
    try {
      page = await this.getApplyPage();
      const navigationStartedAt = Date.now();
      const response = await page.goto('https://pda.104.com.tw/my104/index', { waitUntil: 'domcontentloaded' });
      this.assertNavigationResponse(response?.status(), 'login', page, navigationStartedAt);
      await page.waitForTimeout(3000);
      const issue = await this.getAccessIssue(page, 'login', true);
      return issue === null;
    } catch (err) {
      console.error('驗證 104 登入 Session 時發生例外:', err);
      return false;
    } finally {
      if (page) await this.closePage(page);
    }
  }

  /**
   * Opens the real form and observes its state without touching user input.
   * This method does not check boxes, fill text, or click the final submit
   * control. It is intentionally a separate API from `applyToJob`.
   */
  public async preflightApplication(
    jobId: string,
    options: ApplicationPreflightOptions = {},
  ): Promise<ApplicationPreflightResult> {
    let session: ApplicationFormSession | null = null;
    try {
      console.log(`[Dry-run] 開啟 104 應徵表單進行唯讀檢查，jobId: ${jobId}...`);
      session = await this.openApplicationForm(jobId);
      const inspection = await this.inspectForm(session.targetPage);

      if (!inspection.result.textareaFound || !inspection.result.submitButtonFound) {
        return {
          status: 'form_unavailable',
          message: '表單缺少自薦信欄位或最終送出控制項，已停止且未修改表單。',
          form: inspection.result,
        };
      }
      if (!inspection.result.textareaVisible || !inspection.result.textareaEnabled ||
          !inspection.result.submitButtonVisible || !inspection.result.submitButtonEnabled) {
        return {
          status: 'form_unavailable',
          message: '表單的重要控制項不可見或不可用，已停止且未修改表單。',
          form: inspection.result,
        };
      }

      const result: ApplicationPreflightResult = {
        status: 'ready_for_review',
        message: inspection.result.uncheckedCheckboxCount > 0
          ? '已到達送出前表單；偵測到未勾選選項，未自動變更任何同意或偏好設定。'
          : '已到達送出前表單；未填入自薦信、未變更選項、未點擊最終送出。',
        form: inspection.result,
      };
      if (options.pauseBeforeClose) await this.pauseForHumanReview();
      return result;
    } catch (err: any) {
      if (err instanceof PlatformAccessError) {
        return {
          status: err.code === 'SESSION_EXPIRED' ? 'login_required' : 'platform_limited',
          message: err.message,
        };
      }
      if (err instanceof ApplicationFormError) {
        const status = err.code === 'ALREADY_APPLIED'
          ? 'already_applied'
          : err.code === 'JOB_UNAVAILABLE'
            ? 'job_unavailable'
            : 'form_unavailable';
        return { status, message: err.message };
      }
      console.error('Dry-run 應徵表單檢查失敗:', err);
      return {
        status: 'error',
        message: `表單檢查例外：${err instanceof Error ? err.message : String(err)}`,
      };
    } finally {
      await this.closeApplicationForm(session);
    }
  }

  public async applyToJob(jobId: string, coverLetter: string): Promise<boolean> {
    console.log(`Opening application page in authenticated context for jobId: ${jobId}...`);
    let session: ApplicationFormSession | null = null;

    try {
      session = await this.openApplicationForm(jobId);
      const inspection = await this.inspectForm(session.targetPage);

      if (!inspection.textarea || !inspection.submitButton ||
          !inspection.result.textareaVisible || !inspection.result.textareaEnabled ||
          !inspection.result.submitButtonVisible || !inspection.result.submitButtonEnabled) {
        console.error('應徵表單缺少可用的自薦信欄位或最終送出按鈕。');
        return false;
      }

      // Checkbox meanings are platform-controlled. Some visible options grant
      // marketing consent or change resume visibility, so never force-check
      // them. A live run stops for review instead.
      if (inspection.result.uncheckedCheckboxCount > 0) {
        console.error(`表單有 ${inspection.result.uncheckedCheckboxCount} 個未勾選選項；為避免變更同意或偏好設定，未自動送出。`);
        return false;
      }

      console.log('Writing cover letter...');
      await inspection.textarea.fill(coverLetter);
      await session.targetPage.waitForTimeout(1000);

      console.log('Submitting application...');
      await inspection.submitButton.click();
      await session.targetPage.waitForTimeout(4000);

      const resultText = await this.getBodyText(session.targetPage);
      const successIndicators = ['應徵完成', '應徵已送出', '送出應徵成功', '您已成功應徵'];
      return successIndicators.some(indicator => resultText.includes(indicator));
    } catch (err: any) {
      if (err instanceof PlatformAccessError) throw err;
      console.error('Error during job application:', err);
      return false;
    } finally {
      await this.closeApplicationForm(session);
    }
  }
}
