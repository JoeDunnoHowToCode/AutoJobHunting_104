import PQueue from 'p-queue';
import { Page } from 'playwright';
import { JobPlatform, ScrapedJob } from './platforms/base';
import { Platform104 } from './platforms/platform104';
import { LLMFactory } from './ai/factory';
import { db, JobRecord } from './db';
import { config, pipelineConfig } from './config';
import { PipelineState } from './pipeline-state';
import * as fs from 'fs';
import { saveToNotion } from './notion';
import { sendTelegramMessage } from './telegram';

function getLocalTime(): string {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().split('T')[1].split('.')[0];
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isBlacklisted(job: ScrapedJob): boolean {
  return config.blacklistKeywords.some(keyword => {
    const trimmed = keyword.trim();
    return trimmed.length >= 2 && (job.company.includes(trimmed) || job.title.includes(trimmed));
  });
}

function passesSalaryFilter(jdText: string, expectedSalary: number, acceptNegotiable: boolean): boolean {
  if (jdText.includes('面議')) return acceptNegotiable;
  if (expectedSalary <= 0) return true;

  const match = jdText.match(/月薪\s*(\d{1,3}(?:,\d{3})*)(?:\s*(?:~|～|至|-)\s*(\d{1,3}(?:,\d{3})*))?/);
  if (!match) return true;
  const high = parseInt((match[2] || match[1]).replace(/,/g, ''), 10);
  return high >= expectedSalary;
}

async function main() {
  console.log('==================================================');
  console.log('104 人力銀行 自動化求職投遞系統 (P2 滑動窗口 Pipeline)');
  console.log('==================================================');
  console.log('執行時間:', new Date().toLocaleString());

  if (!fs.existsSync(config.resumePath)) {
    throw new Error(`找不到履歷檔案: ${config.resumePath}`);
  }

  let searchKeywords: string[];
  let expectedSalary = 0;
  let acceptNegotiable = true;
  try {
    const resume = JSON.parse(fs.readFileSync(config.resumePath, 'utf8'));
    expectedSalary = resume.basic_info?.expected_salary_monthly || 0;
    acceptNegotiable = resume.basic_info?.accept_negotiable_salary ?? true;
    const desiredTitle = resume.basic_info?.desired_title || '';
    searchKeywords = desiredTitle.split(/[,、]/).map((value: string) => value.trim()).filter(Boolean);
  } catch (error) {
    throw new Error(`解析 ${config.resumePath} 失敗: ${String(error)}`);
  }

  if (searchKeywords.length === 0) {
    throw new Error(`在 ${config.resumePath} 的 basic_info.desired_title 中未設定搜尋職稱關鍵字。`);
  }
  searchKeywords = searchKeywords.sort(() => Math.random() - 0.5);

  if (!fs.existsSync(config.authStatePath)) {
    throw new Error(`找不到登入 Session 檔案: ${config.authStatePath}；請先執行 npm run login。`);
  }

  console.log('搜尋關鍵字:', searchKeywords.join(', '));
  console.log('契合度門檻分數:', config.scoreThreshold);
  console.log('單次最多投遞數:', config.applyLimitPerRun);
  console.log(`內部佇列限制: JD=${pipelineConfig.jdConcurrency}, AI=${pipelineConfig.aiConcurrency}, Apply=1, in-flight=${pipelineConfig.maxInFlightJobs}`);

  const platforms: JobPlatform[] = [new Platform104()];
  const pipeline = new PipelineState();
  const jdQueue = new PQueue({ concurrency: pipelineConfig.jdConcurrency });
  const llmQueue = new PQueue({ concurrency: pipelineConfig.aiConcurrency });
  const applyQueue = new PQueue({ concurrency: 1 });
  const processedInThisRun: JobRecord[] = [];
  let appliedCount = 0;
  let processedCount = 0;
  let sessionExpired = false;
  let sessionNoticeSent = false;
  let producerPaused = false;

  const record = (job: ScrapedJob, status: JobRecord['status'], reason: string, location = '未知', score = 0, coverLetter?: string): JobRecord => {
    const item: JobRecord = {
      jobId: job.jobId,
      title: job.title,
      company: job.company,
      location,
      url: job.url,
      score,
      reason,
      status,
      processedAt: getLocalTime(),
      ...(coverLetter ? { coverLetter } : {}),
    };
    if (status === 'applied') item.applyId = db.getNextApplyId();
    db.addRecord(item);
    processedInThisRun.push(item);
    return item;
  };

  const applyLoad = () => applyQueue.size + applyQueue.pending;

  const stopForExpiredSession = async (platform: JobPlatform, job: ScrapedJob): Promise<void> => {
    if (sessionExpired) return;
    sessionExpired = true;
    jdQueue.clear();
    llmQueue.clear();
    applyQueue.clear();
    pipeline.clearPending();
    console.error(`[重大錯誤] 偵測到 ${platform.platformName} Session 已過期，已停止未開始的工作。`);
    if (!sessionNoticeSent) {
      sessionNoticeSent = true;
      await sendTelegramMessage(`🚨 <b>[自動投遞系統中途終止]</b>\n在投遞「${job.title}」時偵測到 104 登入已過期。請執行 <code>npm run login</code> 重新驗證。`);
    }
  };

  const waitForCapacity = async (): Promise<void> => {
    if (!producerPaused && (
      !pipeline.canAcceptMore(pipelineConfig.maxInFlightJobs) ||
      applyLoad() >= pipelineConfig.maxApplyQueueSize ||
      appliedCount + pipeline.reservedApplyCount >= config.applyLimitPerRun
    )) {
      producerPaused = true;
      console.log(`[佇列背壓] in-flight=${pipeline.inFlightCount}/${pipelineConfig.maxInFlightJobs}, apply=${applyLoad()}/${pipelineConfig.maxApplyQueueSize}；暫停 Producer。`);
    }

    while (producerPaused && !sessionExpired && appliedCount < config.applyLimitPerRun) {
      if (
        pipeline.canAcceptMore(pipelineConfig.maxInFlightJobs) &&
        applyLoad() <= pipelineConfig.resumeApplyQueueSize &&
        appliedCount + pipeline.reservedApplyCount < config.applyLimitPerRun
      ) {
        producerPaused = false;
        console.log('[佇列背壓解除] 恢復 Producer 搜尋。');
      } else {
        await sleep(1000);
      }
    }
  };

  const enqueueApply = (platform: JobPlatform, job: ScrapedJob, location: string, score: number, reason: string, coverLetter: string): void => {
    void applyQueue.add(async () => {
      try {
        if (sessionExpired) return;
        if (appliedCount >= config.applyLimitPerRun) {
          record(job, 'skipped', '本次投遞上限已達成，未執行實體投遞', location, score);
          return;
        }

        const success = await platform.applyToJob(job.jobId, coverLetter);
        if (!success) {
          record(job, 'failed', `投遞失敗: 流程未確認完成\n原分析理由: ${reason}`, location, score);
          return;
        }

        const applied = record(job, 'applied', reason, location, score, coverLetter);
        appliedCount++;
        console.log(`[應徵成功] 已投遞第 ${appliedCount} 個職缺：「${job.title}」 - ${job.company}`);
        try {
          await saveToNotion(applied);
        } catch (error) {
          console.error(`Notion 同步失敗 (${job.jobId})，本地投遞紀錄已保留:`, error);
        }

        const delay = Math.floor(Math.random() * 10000) + 10000;
        console.log(`等待投遞後操作間隔，延遲 ${delay / 1000} 秒...`);
        await sleep(delay);
      } catch (error: any) {
        if (error?.message === 'SESSION_EXPIRED') {
          record(job, 'failed', '投遞中偵測到登入 Session 已過期', location, score);
          await stopForExpiredSession(platform, job);
        } else {
          console.error(`投遞過程發生例外 (${job.jobId}):`, error);
          record(job, 'failed', `投遞例外: ${error instanceof Error ? error.message : String(error)}`, location, score);
        }
      } finally {
        pipeline.finish(job.jobId);
      }
    }).catch(error => console.error(`Apply queue task 未處理錯誤 (${job.jobId}):`, error));
  };

  const enqueueLlm = (platform: JobPlatform, job: ScrapedJob, jdText: string, location: string): void => {
    void llmQueue.add(async () => {
      let handedToApply = false;
      let slotReserved = false;
      try {
        if (sessionExpired) return;
        const aiService = LLMFactory.getProvider();
        const evaluation = await aiService.evaluateJob(job.title, job.company, jdText);
        const formattedReason = evaluation.reason.replace(/(\d+\.\s)/g, '\n$1').trim();
        console.log(`[AI] ${job.title}: ${evaluation.score} 分 (${evaluation.decision || 'N/A'})`);

        if (!evaluation.shouldApply) {
          const reason = evaluation.score < config.scoreThreshold
            ? `分數 (${evaluation.score}) 未達門檻 (${config.scoreThreshold})\n${formattedReason}`
            : `必備條件嚴重缺失 (${evaluation.decision || 'N/A'})\n${formattedReason}`;
          record(job, 'skipped', reason, location, evaluation.score);
          return;
        }

        if (!pipeline.reserveApply(job.jobId, appliedCount, config.applyLimitPerRun)) {
          record(job, 'skipped', '本次投遞名額已保留給先完成評估的職缺', location, evaluation.score);
          return;
        }
        slotReserved = true;

        const content = await aiService.generateCustomizedContent(job.title, job.company, jdText, {
          strengths: evaluation.strengths,
          gaps: evaluation.gaps,
          decision: evaluation.decision,
        });
        if (sessionExpired) return;

        enqueueApply(platform, job, location, evaluation.score, formattedReason, content.coverLetter);
        handedToApply = true;
      } catch (error) {
        console.error(`AI 處理失敗 (${job.jobId}):`, error);
        record(job, 'failed', `AI 評估／自薦信生成失敗: ${error instanceof Error ? error.message : String(error)}`, location);
      } finally {
        if (slotReserved && !handedToApply) pipeline.releaseApply(job.jobId);
        if (!handedToApply) pipeline.finish(job.jobId);
      }
    }).catch(error => console.error(`LLM queue task 未處理錯誤 (${job.jobId}):`, error));
  };

  const enqueueJd = (platform: JobPlatform, job: ScrapedJob): void => {
    void jdQueue.add(async () => {
      let detailPage: Page | null = null;
      let handedToLlm = false;
      try {
        if (sessionExpired) return;
        detailPage = await platform.getDetailPage();
        const jdData = await platform.getJobDescription(detailPage, job.url);
        if (!passesSalaryFilter(jdData.jdText, expectedSalary, acceptNegotiable)) {
          record(job, 'skipped', '未達期望薪資', jdData.location);
          return;
        }
        enqueueLlm(platform, job, jdData.jdText, jdData.location);
        handedToLlm = true;
      } catch (error) {
        console.error(`擷取 JD 失敗 (${job.jobId}):`, error);
        record(job, 'failed', `JD 擷取失敗: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (detailPage) await platform.closePage(detailPage);
        if (!handedToLlm) pipeline.finish(job.jobId);
      }
    }).catch(error => console.error(`JD queue task 未處理錯誤 (${job.jobId}):`, error));
  };

  try {
    for (const platform of platforms) {
      if (!await platform.verifyLogin()) {
        throw new Error(`${platform.platformName} 登入 Session 已過期或無效；請執行 npm run login。`);
      }
      console.log(`[驗證成功] ${platform.platformName} 登入 Session 有效。`);

      for (const keyword of searchKeywords) {
        if (sessionExpired || appliedCount >= config.applyLimitPerRun) break;
        let pageNum = 1;
        let consecutiveAlreadyProcessed = 0;

        while (!sessionExpired && appliedCount < config.applyLimitPerRun && pageNum <= 100) {
          await waitForCapacity();
          if (sessionExpired) break;

          let searchPage: Page | null = null;
          let jobs: ScrapedJob[] = [];
          try {
            searchPage = await platform.getSearchPage();
            jobs = await platform.searchJobs(searchPage, keyword, pageNum);
          } finally {
            if (searchPage) await platform.closePage(searchPage);
          }
          if (jobs.length === 0) break;

          for (const job of jobs) {
            await waitForCapacity();
            if (sessionExpired || appliedCount >= config.applyLimitPerRun) break;

            if (!pipeline.tryStart(job.jobId, db)) {
              consecutiveAlreadyProcessed++;
              if (consecutiveAlreadyProcessed >= 25 && pageNum >= 2) break;
              continue;
            }
            consecutiveAlreadyProcessed = 0;
            processedCount++;

            if (isBlacklisted(job)) {
              record(job, 'skipped', '黑名單略過');
              pipeline.finish(job.jobId);
              continue;
            }
            enqueueJd(platform, job);
          }

          if (consecutiveAlreadyProcessed >= 25 && pageNum >= 2) break;
          pageNum++;
          await sleep(Math.floor(Math.random() * 2000) + 2000);
        }
      }
    }
  } catch (error) {
    console.error('執行主流程時發生錯誤:', error);
  } finally {
    console.log(`等待佇列收尾：已檢查 ${processedCount} 筆，in-flight ${pipeline.inFlightCount} 筆。`);
    await jdQueue.onIdle();
    await llmQueue.onIdle();
    await applyQueue.onIdle();
    for (const platform of platforms) await platform.closeBrowsers();
  }

  const appliedJobs = processedInThisRun.filter(job => job.status === 'applied');
  const failedJobs = processedInThisRun.filter(job => job.status === 'failed');
  const skippedJobs = processedInThisRun.filter(job => job.status === 'skipped');
  console.log(`任務完成：成功 ${appliedJobs.length}，失敗 ${failedJobs.length}，略過 ${skippedJobs.length}。`);

  if (appliedJobs.length > 0 || failedJobs.length > 0) {
    const report = `<b>📊 本次投遞報告</b>\n\n成功投遞：${appliedJobs.length}\n投遞失敗：${failedJobs.length}\n略過：${skippedJobs.length}`;
    await sendTelegramMessage(report);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('系統終止:', error);
    process.exitCode = 1;
  });
}
