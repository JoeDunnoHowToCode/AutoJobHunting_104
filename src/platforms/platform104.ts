import { Page } from 'playwright';
import { JobPlatform, ScrapedJob } from './base';

export class Platform104 extends JobPlatform {
  public readonly platformName = '104';

  public async searchJobs(page: Page, keyword: string, pageNum: number = 1): Promise<ScrapedJob[]> {
    console.log(`Searching for jobs on 104 with keyword: "${keyword}", Page: ${pageNum}...`);
    const searchUrl = `https://www.104.com.tw/jobs/search/?clean=1&ro=0&keyword=${encodeURIComponent(keyword)}&isnew=7&order=11&asc=0&page=${pageNum}`;
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    
    // Robust 8-second wait to ensure background thread resources finish rendering Vue Virtual Scroller
    await page.waitForTimeout(8000); 

    const title = await page.title();
    console.log(`[Debug Search] Page Title: "${title}"`);

    // Scroll down multiple times to trigger lazy loading of more jobs
    console.log('Scrolling down to load more job listings...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(1500);
    }

    const jobItems: ScrapedJob[] = [];
    const jobLinks = await page.locator('a').all();
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
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const selectors = [
      '.job-description',
      '.job-description-table',
      '.job-requirement'
    ];

    let jdText = '';
    for (const selector of selectors) {
      const element = page.locator(selector).first();
      if (await element.count() > 0) {
        jdText += '\
' + (await element.innerText()).trim() + '\
';
      }
    }

    if (!jdText) {
      jdText = await page.locator('body').innerText();
    }

    jdText = jdText.replace(/\\s+/g, ' ').substring(0, 3000);

    // Extract location using 104 specific regex
    const locMatch = jdText.match(/(?:上班地點|工作地點)[：\\s]*([\\s\\S]*?)(?=管理責任|出差外派|上班時段|休假制度|可上班日|$)/);
    const location = locMatch ? locMatch[1].trim() : '未知';

    return { jdText, location };
  }

  public async applyToJob(jobId: string, coverLetter: string): Promise<boolean> {
    console.log(`Opening application page in authenticated context for jobId: ${jobId}...`);
    const page = await this.getApplyPage();
    const jobUrl = `https://www.104.com.tw/job/${jobId}`;

    let targetPage: Page = page;
    let popupOpened = false;

    try {
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const applyButton = page.locator('[data-v-e3fvojuuftu="apply-button"]')
        .or(page.locator('.apply-button__button'))
        .or(page.locator('.apply-button'))
        .or(page.getByRole('link', { name: '我要應徵' }))
        .or(page.getByRole('button', { name: '我要應徵' }))
        .or(page.getByText('我要應徵'))
        .first();

      if (await applyButton.count() === 0) {
        console.error('Could not find the "我要應徵" button on page.');
        await page.close();
        return false;
      }

      const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);
      await applyButton.click();
      
      const popup = await popupPromise;
      if (popup) {
        console.log('Application form opened in a new tab.');
        targetPage = popup;
        popupOpened = true;
        await targetPage.waitForLoadState('domcontentloaded');
        await targetPage.waitForTimeout(2000);
      } else {
        console.log('No new tab opened. Operating on the page modal. Waiting 4 seconds...');
        await page.waitForTimeout(4000);
      }

      const checkboxes = await targetPage.locator('input[type="checkbox"]').all();
      for (const cb of checkboxes) {
        const isVisible = await cb.isVisible();
        if (isVisible && !(await cb.isChecked())) {
          console.log('Checking required agreement checkbox...');
          await cb.check({ force: true });
        }
      }

      const textarea = targetPage.locator('textarea[name="recommend"]')
        .or(targetPage.locator('textarea#recommend'))
        .or(targetPage.locator('textarea[placeholder*="推薦"]'))
        .or(targetPage.locator('textarea'))
        .first();

      if (await textarea.count() === 0) {
        console.error('Could not find the Cover Letter textarea.');
        if (popupOpened) await targetPage.close();
        await page.close();
        return false;
      }

      console.log('Writing cover letter...');
      await textarea.click();
      await textarea.fill('');
      await textarea.fill(coverLetter);
      await targetPage.waitForTimeout(1000);

      const submitButton = targetPage.getByRole('button', { name: '確認應徵' })
        .or(targetPage.getByRole('button', { name: '確認送出' }))
        .or(targetPage.getByRole('button', { name: '送出應徵' }))
        .or(targetPage.getByText('確認送出'))
        .or(targetPage.getByText('確認應徵'))
        .first();

      if (await submitButton.count() === 0) {
        console.error('Could not find final Submit button.');
        if (popupOpened) await targetPage.close();
        await page.close();
        return false;
      }

      console.log('Submitting application...');
      await submitButton.click();
      await targetPage.waitForTimeout(4000);

      const successIndicators = ['應徵完成', '成功', '您已應徵', '送出成功', '已應徵'];
      let isSuccess = false;
      
      const bodyText = await targetPage.locator('body').innerText();
      for (const indicator of successIndicators) {
        if (bodyText.includes(indicator)) {
          isSuccess = true;
          break;
        }
      }

      if (popupOpened && targetPage.isClosed()) {
        isSuccess = true;
      }

      if (popupOpened && !targetPage.isClosed()) {
        await targetPage.close();
      }
      
      await page.close();
      return isSuccess;

    } catch (err) {
      console.error('Error during job application:', err);
      if (popupOpened && !targetPage.isClosed()) {
        await targetPage.close();
      }
      await page.close();
      return false;
    }
  }
}
