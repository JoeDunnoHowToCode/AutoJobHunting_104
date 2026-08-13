import PQueue from 'p-queue';
import { Page } from 'playwright';
import { JobPlatform, ScrapedJob } from './platforms/base';
import { Platform104, PlatformAccessError } from './platforms/platform104';
import { LLMFactory } from './ai/factory';
import { JobDatabase, JobRecord } from './db';
import { config, pipelineConfig } from './config';
import { PipelineState } from './pipeline-state';
import * as fs from 'fs';
import { saveToNotion } from './notion';
import { sendTelegramMessage } from './telegram';
import {
  executeApplicationAction,
  getRuntimePipelineLimits,
  resolveRunMode,
  RunMode,
} from './application-action';

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

export async function main(runMode: RunMode = resolveRunMode()) {
  const isDryRun = runMode === 'dry-run';
  const runLimit = isDryRun ? 1 : config.applyLimitPerRun;
  const runtimePipelineConfig = getRuntimePipelineLimits(runMode, pipelineConfig);
  const pauseBeforeClose = isDryRun && !config.headless && process.argv.includes('--pause-before-close');

  console.log('==================================================');
  console.log(isDryRun
    ? '104 人力銀行 應徵前唯讀測試 (P2 滑動窗口 Pipeline)'
    : '104 人力銀行 自動化求職投遞系統 (P2 滑動窗口 Pipeline)');
  console.log('==================================================');
  console.log('執行時間:', new Date().toLocaleString());
  if (isDryRun) {
    console.log('[DRY-RUN] 僅檢查一個候選職缺到最終送出前；不寫入 applyRecord、Notion、Telegram，且不填寫或送出表單。');
    if (process.argv.includes('--pause-before-close') && !pauseBeforeClose) {
      console.warn('[DRY-RUN] --pause-before-close 只能搭配可見瀏覽器模式使用；已忽略。');
    }
  }

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
  // A dry-run should be repeatable and only inspect the first candidate. Live
  // mode keeps the existing search-keyword rotation behaviour.
  if (!isDryRun) {
    searchKeywords = searchKeywords.sort(() => Math.random() - 0.5);
  }

  if (!fs.existsSync(config.authStatePath)) {
    throw new Error(`找不到登入 Session 檔案: ${config.authStatePath}；請先執行 npm run login。`);
  }

  // Build the store only after required input is valid. In dry-run it can read
  // historical records for de-duplication but is structurally unable to write.
  const database = new JobDatabase(config.dbPath, { readOnly: isDryRun });

  console.log('搜尋關鍵字:', searchKeywords.join(', '));
  console.log('契合度門檻分數:', config.scoreThreshold);
  console.log(isDryRun ? '本次最多檢查表單數:' : '單次最多投遞數:', runLimit);
  console.log(`內部佇列限制: JD=${runtimePipelineConfig.jdConcurrency}, AI=${runtimePipelineConfig.aiConcurrency}, Apply=1, in-flight=${runtimePipelineConfig.maxInFlightJobs}`);

  const platforms: JobPlatform[] = [new Platform104()];
  const pipeline = new PipelineState();
  const jdQueue = new PQueue({ concurrency: runtimePipelineConfig.jdConcurrency });
  const llmQueue = new PQueue({ concurrency: runtimePipelineConfig.aiConcurrency });
  const applyQueue = new PQueue({ concurrency: 1 });
  const processedInThisRun: JobRecord[] = [];
  const preflightResults: Array<{ job: ScrapedJob; score: number; result: Awaited<ReturnType<JobPlatform['preflightApplication']>> }> = [];
  let appliedCount = 0;
  let preflightCount = 0;
  let dryRunCandidateCount = 0;
  let processedCount = 0;
  let pipelineStopped = false;
  let stopNoticeSent = false;
  let producerPaused = false;

  const completedActionCount = () => isDryRun ? preflightCount : appliedCount;
  const reachedRunLimit = () => completedActionCount() >= runLimit;
  const reachedCandidateLimit = () => isDryRun && dryRunCandidateCount >= 1;

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
    if (isDryRun && status === 'applied') {
      throw new Error('Dry-run must never create an applied record.');
    }
    if (!isDryRun) {
      if (status === 'applied') item.applyId = database.getNextApplyId();
      database.addRecord(item);
    }
    processedInThisRun.push(item);
    return item;
  };

  const applyLoad = () => applyQueue.size + applyQueue.pending;

  const stopForPlatformAccess = async (
    platform: JobPlatform,
    job: ScrapedJob | undefined,
    reason: string,
  ): Promise<void> => {
    if (pipelineStopped) return;
    pipelineStopped = true;
    jdQueue.clear();
    llmQueue.clear();
    applyQueue.clear();
    pipeline.clearPending();
    console.error(`[重大錯誤] ${platform.platformName}：${reason} 已停止未開始的工作。`);
    if (!isDryRun && !stopNoticeSent) {
      stopNoticeSent = true;
      await sendTelegramMessage(`🚨 <b>[自動投遞系統中途終止]</b>\n處理「${job?.title || '搜尋階段'}」時發現：${reason}`);
    }
  };

  const waitForCapacity = async (): Promise<void> => {
    if (!producerPaused && (
      !pipeline.canAcceptMore(runtimePipelineConfig.maxInFlightJobs) ||
      applyLoad() >= runtimePipelineConfig.maxApplyQueueSize ||
      completedActionCount() + pipeline.reservedApplyCount >= runLimit
    )) {
      producerPaused = true;
      console.log(`[佇列背壓] in-flight=${pipeline.inFlightCount}/${runtimePipelineConfig.maxInFlightJobs}, apply=${applyLoad()}/${runtimePipelineConfig.maxApplyQueueSize}；暫停 Producer。`);
    }

    while (producerPaused && !pipelineStopped && !reachedRunLimit()) {
      if (
        pipeline.canAcceptMore(runtimePipelineConfig.maxInFlightJobs) &&
        applyLoad() <= runtimePipelineConfig.resumeApplyQueueSize &&
        completedActionCount() + pipeline.reservedApplyCount < runLimit
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
        if (pipelineStopped) return;
        if (reachedRunLimit()) {
          record(job, 'skipped', isDryRun ? 'Dry-run 表單檢查上限已達成' : '本次投遞上限已達成，未執行實體投遞', location, score);
          return;
        }

        const action = await executeApplicationAction(runMode, platform, job.jobId, coverLetter, {
          preflight: { pauseBeforeClose },
        });
        if (action.type === 'preflight') {
          preflightCount++;
          preflightResults.push({ job, score, result: action.result });
          console.log(`[Dry-run] ${job.title}：${action.result.status} — ${action.result.message}`);

          if (action.result.status === 'login_required' || action.result.status === 'platform_limited') {
            await stopForPlatformAccess(platform, job, action.result.message);
          }
          return;
        }

        if (!action.submitted) {
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
        if (error instanceof PlatformAccessError) {
          record(job, 'failed', `投遞中停止：${error.message}`, location, score);
          await stopForPlatformAccess(platform, job, error.message);
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
        if (pipelineStopped) return;
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

        if (!pipeline.reserveApply(job.jobId, completedActionCount(), runLimit)) {
          record(job, 'skipped', isDryRun ? 'Dry-run 唯一表單檢查名額已保留給先完成評估的職缺' : '本次投遞名額已保留給先完成評估的職缺', location, evaluation.score);
          return;
        }
        slotReserved = true;

        const content = await aiService.generateCustomizedContent(job.title, job.company, jdText, {
          strengths: evaluation.strengths,
          gaps: evaluation.gaps,
          decision: evaluation.decision,
        });
        if (pipelineStopped) return;

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
        if (pipelineStopped) return;
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
        if (error instanceof PlatformAccessError) {
          await stopForPlatformAccess(platform, job, error.message);
        }
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
        if (pipelineStopped || reachedRunLimit() || reachedCandidateLimit()) break;
        let pageNum = 1;
        let consecutiveAlreadyProcessed = 0;

        while (!pipelineStopped && !reachedRunLimit() && !reachedCandidateLimit() && pageNum <= 100) {
          await waitForCapacity();
          if (pipelineStopped || reachedRunLimit()) break;

          let searchPage: Page | null = null;
          let jobs: ScrapedJob[] = [];
          try {
            searchPage = await platform.getSearchPage();
            jobs = await platform.searchJobs(searchPage, keyword, pageNum);
          } catch (error) {
            if (error instanceof PlatformAccessError) {
              await stopForPlatformAccess(platform, undefined, error.message);
            }
            throw error;
          } finally {
            if (searchPage) await platform.closePage(searchPage);
          }
          if (jobs.length === 0) break;

          for (const job of jobs) {
            await waitForCapacity();
            if (pipelineStopped || reachedRunLimit() || reachedCandidateLimit()) break;

            if (!pipeline.tryStart(job.jobId, database)) {
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
            if (isDryRun) dryRunCandidateCount++;
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
  if (isDryRun) {
    const readyForReview = preflightResults.filter(item => item.result.status === 'ready_for_review');
    console.log(`Dry-run 完成：候選 ${dryRunCandidateCount}，已檢查 ${preflightResults.length} 個表單，送出前可審核 ${readyForReview.length} 個，流程失敗 ${failedJobs.length}，略過 ${skippedJobs.length}，正式投遞 0 個。`);
    for (const item of preflightResults) {
      console.log(`[Dry-run 結果] ${item.job.jobId} | ${item.result.status} | score=${item.score}`);
    }
  } else {
    console.log(`任務完成：成功 ${appliedJobs.length}，失敗 ${failedJobs.length}，略過 ${skippedJobs.length}。`);
  }

  if (!isDryRun && (appliedJobs.length > 0 || failedJobs.length > 0)) {
    const report = `<b>📊 本次投遞報告</b>\n\n成功投遞：${appliedJobs.length}\n投遞失敗：${failedJobs.length}\n略過：${skippedJobs.length}`;
    await sendTelegramMessage(report);
  }
}

if (require.main === module) {
  main(resolveRunMode()).catch(error => {
    console.error('系統終止:', error);
    process.exitCode = 1;
  });
}
