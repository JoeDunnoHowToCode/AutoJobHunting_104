import PQueue from 'p-queue';
import { JobPlatform, ScrapedJob } from './platforms/base';
import { Platform104 } from './platforms/platform104';
import { LLMFactory } from './ai/factory';
import { db, JobRecord } from './db';
import { config } from './config';
import * as fs from 'fs';
import { saveToNotion } from './notion';
import { sendTelegramMessage } from './telegram';

function getLocalTime(): string {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  const localTime = new Date(now.getTime() - tzOffset);
  return localTime.toISOString().split('T')[1].split('.')[0];
}

async function main() {
  console.log('==================================================');
  console.log('104 人力銀行 自動化求職投遞系統 (P2 滑動窗口 Pipeline)');
  console.log('==================================================');
  console.log('執行時間:', new Date().toLocaleString());
  let searchKeywords: string[] = [];
  let expectedSalary = 0;
  let acceptNegotiable = true;

  if (!fs.existsSync(config.resumePath)) {
    console.error(`[重大錯誤] 找不到履歷檔案: ${config.resumePath}`);
    process.exit(1);
  }

  try {
    const resumeJson = JSON.parse(fs.readFileSync(config.resumePath, 'utf8'));
    expectedSalary = resumeJson.basic_info?.expected_salary_monthly || 0;
    acceptNegotiable = resumeJson.basic_info?.accept_negotiable_salary ?? true;
    const desiredTitle = resumeJson.basic_info?.desired_title || '';
    if (desiredTitle) {
      searchKeywords = desiredTitle.split(/[,、]/).map((k: string) => k.trim()).filter((k: string) => k);
      searchKeywords = searchKeywords.sort(() => Math.random() - 0.5);
    }
  } catch (err) {
    console.error(`[重大錯誤] 解析 ${config.resumePath} 失敗:`, err);
    process.exit(1);
  }

  if (searchKeywords.length === 0) {
    console.error(`\n==================================================`);
    console.error(`[重大錯誤] 在 ${config.resumePath} 的 basic_info.desired_title 中未設定任何搜尋職稱關鍵字！`);
    console.error(`請先編輯 ${config.resumePath} 並填寫 desired_title (例: "AI工程師, 軟體工程師") 再執行。`);
    console.error(`==================================================\n`);
    process.exit(1);
  }

  console.log('搜尋關鍵字:', searchKeywords.join(', '));
  console.log('契合度門檻分數:', config.scoreThreshold);
  console.log('單次最多投遞數:', config.applyLimitPerRun);
  console.log(`並發數設定: JD=${config.jdConcurrency}, AI=${config.aiConcurrency}, Apply=1 (積壓上限=${config.maxApplyQueueSize})`);
  console.log('==================================================\n');

  if (!fs.existsSync(config.authStatePath)) {
    console.error(`[錯誤] 找不到登入 Session 檔案: ${config.authStatePath}`);
    console.error('請先在終端機執行 "npm run login" 進行首次手動登入並儲存 Session！');
    process.exit(1);
  }

  console.log('正在啟動瀏覽器自動化服務...');
  const platforms: JobPlatform[] = [new Platform104()];

  let appliedCount = 0;
  let processedCount = 0;
  let reservedSlots = 0;
  const processedInThisRun: JobRecord[] = [];

  const inFlightJobIds = new Set<string>();
  const attemptedThisRun = new Set<string>();

  const jdQueue = new PQueue({ concurrency: config.jdConcurrency });
  const llmQueue = new PQueue({ concurrency: config.aiConcurrency });
  const applyQueue = new PQueue({ concurrency: 1 });

  let sessionExpiredError = false;

  try {
    for (const platform of platforms) {
      console.log(`\n=== 開始驗證平台登入狀態: ${platform.platformName} ===`);
      const isLoggedIn = await platform.verifyLogin();
      if (!isLoggedIn) {
        const errorMsg = `[重大錯誤] ${platform.platformName} 登入 Session 已過期或無效！\n程式已自動終止投遞。請在終端機執行 "npm run login" 重新完成驗證。`;
        console.error(`\n==================================================`);
        console.error(errorMsg);
        console.error(`==================================================\n`);
        await sendTelegramMessage(`🚨 <b>[自動投遞系統終止]</b>\n${platform.platformName} 登入 Session 已過期！\n請重新執行 <code>npm run login</code> 完成驗證。`);
        process.exit(1);
      }
      console.log(`[驗證成功] ${platform.platformName} 登入 Session 有效。\n`);

      console.log(`\n=== 開始執行平台任務: ${platform.platformName} ===`);
      for (const keyword of searchKeywords) {
        if (appliedCount + reservedSlots >= config.applyLimitPerRun || sessionExpiredError) {
          console.log(`已達到預約投遞上限 (${config.applyLimitPerRun}) 或 Session 過期，停止搜尋。`);
          break;
        }

        console.log(`\n--- 開始處理關鍵字: "${keyword}" ---`);
        
        let pageNum = 1;
        let consecutiveSkipped = 0;
        let shouldSwitchKeyword = false;

        while (appliedCount + reservedSlots < config.applyLimitPerRun && pageNum <= 100 && !sessionExpiredError) {
          // Check backpressure: if applyQueue is full, wait for it to drain
          if (applyQueue.size >= config.maxApplyQueueSize) {
            console.log(`[佇列背壓] 待投遞佇列累積 ${applyQueue.size} 筆 (>= ${config.maxApplyQueueSize})，暫停 Producer 搜尋...`);
            while (applyQueue.size > config.resumeApplyQueueSize && !sessionExpiredError) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
            console.log(`[佇列背壓解除] 待投遞佇列已降至 ${applyQueue.size} 筆，恢復 Producer 搜尋。`);
          }

          const searchPage = await platform.getSearchPage();
          let jobs: ScrapedJob[] = [];
          try {
            jobs = await platform.searchJobs(searchPage, keyword, pageNum);
          } finally {
            await platform.closePage(searchPage);
          }
        
          if (jobs.length === 0) {
            console.log(`第 ${pageNum} 頁沒有找到更多職缺，結束此關鍵字搜尋。`);
            break;
          }
        
          console.log(`成功獲取 第 ${pageNum} 頁共 ${jobs.length} 個職缺。進行併發佇列處置...`);

          for (const job of jobs) {
            if (appliedCount + reservedSlots >= config.applyLimitPerRun || sessionExpiredError) {
              break;
            }

            if (db.hasBeenProcessed(job.jobId) || inFlightJobIds.has(job.jobId) || attemptedThisRun.has(job.jobId)) {
              console.log(`[已略過] 職缺在歷史紀錄或佇列處理中: "${job.title}" - ${job.company} (${job.jobId})`);
              consecutiveSkipped++;
              if (consecutiveSkipped >= 25 && pageNum >= 2) {
                console.log(`連續遇到 25 個已處理過的職缺（已搜尋至第 ${pageNum} 頁），提早結束並切換下一個關鍵字。`);
                shouldSwitchKeyword = true;
                break;
              }
              continue;
            }

            consecutiveSkipped = 0;
            inFlightJobIds.add(job.jobId);
            attemptedThisRun.add(job.jobId);
            processedCount++;

            // Enqueue JD fetching
            jdQueue.add(async () => {
              if (sessionExpiredError) {
                inFlightJobIds.delete(job.jobId);
                return;
              }

              console.log(`\n[進度: 投遞 ${appliedCount}/${config.applyLimitPerRun}, 已檢查 ${processedCount}] [JD 佇列] 正在擷取: "${job.title}" - ${job.company} (${job.jobId})`);
              
              let jdText = '';
              let location = '未知';

              const detailPage = await platform.getDetailPage();
              try {
                const isBlacklisted = config.blacklistKeywords.some(bk => {
                  const trimmed = bk.trim();
                  if (trimmed.length < 2) return false;
                  return job.company.includes(trimmed) || job.title.includes(trimmed);
                });
                if (isBlacklisted) {
                  console.log(`[黑名單略過] 公司或職缺包含黑名單關鍵字: "${job.title}" - ${job.company}`);
                  const record: JobRecord = {
                    jobId: job.jobId, title: job.title, company: job.company, url: job.url,
                    location: '未知', score: 0, reason: '黑名單略過', status: 'skipped',
                    processedAt: getLocalTime()
                  };
                  db.addRecord(record);
                  processedInThisRun.push(record);
                  inFlightJobIds.delete(job.jobId);
                  return;
                }

                const jdData = await platform.getJobDescription(detailPage, job.url);
                jdText = jdData.jdText;
                location = jdData.location;
                console.log(`已成功擷取 JD，長度: ${jdText.length} 字。`);
              } catch (jdErr) {
                console.error(`擷取 JD 失敗 (${job.jobId}):`, jdErr);
                inFlightJobIds.delete(job.jobId);
                return;
              } finally {
                await platform.closePage(detailPage);
              }

              // Salary Filter
              const isNegotiable = jdText.includes('面議');
              let salaryPasses = true;
              if (isNegotiable && !acceptNegotiable) {
                salaryPasses = false;
              } else if (!isNegotiable && expectedSalary > 0) {
                const salaryRangeMatch = jdText.match(/月薪\s*(\d{1,3}(?:,\d{3})*)(?:\s*(?:~|～|至|-)\s*(\d{1,3}(?:,\d{3})*))?/);
                if (salaryRangeMatch) {
                  const salaryLow = parseInt(salaryRangeMatch[1].replace(/,/g, ''), 10);
                  const salaryHigh = salaryRangeMatch[2]
                    ? parseInt(salaryRangeMatch[2].replace(/,/g, ''), 10)
                    : salaryLow;
                  if (salaryHigh < expectedSalary) {
                    salaryPasses = false;
                    console.log(`[薪資略過] JD 薪資區間 ${salaryLow}~${salaryHigh} 上限低於期望薪資 ${expectedSalary}。`);
                  }
                }
              }

              if (!salaryPasses) {
                const record: JobRecord = {
                  jobId: job.jobId, title: job.title, company: job.company, url: job.url,
                  location, score: 0, reason: '未達期望薪資', status: 'skipped',
                  processedAt: getLocalTime()
                };
                db.addRecord(record);
                processedInThisRun.push(record);
                inFlightJobIds.delete(job.jobId);
                return;
              }

              // Enqueue AI Evaluation
              llmQueue.add(async () => {
                if (sessionExpiredError) {
                  inFlightJobIds.delete(job.jobId);
                  return;
                }

                console.log(`[AI 佇列] 調用 (${config.aiProvider}/${config.aiModel}) 評估契合度: "${job.title}" - ${job.company}`);
                try {
                  const aiService = LLMFactory.getProvider();
                  const evaluation = await aiService.evaluateJob(job.title, job.company, jdText);
                  const formattedReason = evaluation.reason.replace(/(\\d+\\.\\s)/g, '\\n$1').trim();
                  console.log(`-> 評估分數: ${evaluation.score} 分 (決策: ${evaluation.decision})`);

                  if (evaluation.shouldApply) {
                    if (appliedCount + reservedSlots >= config.applyLimitPerRun) {
                      console.log(`[額度已被佔滿] 略過此契合職缺: "${job.title}"`);
                      inFlightJobIds.delete(job.jobId);
                      return;
                    }

                    reservedSlots++;
                    console.log(`[契合度合格] 分數 (${evaluation.score})。開始生成客製化自薦信...`);
                    const customContent = await aiService.generateCustomizedContent(job.title, job.company, jdText, {
                      strengths: evaluation.strengths,
                      gaps: evaluation.gaps,
                      decision: evaluation.decision,
                    });

                    // Enqueue Apply Queue (concurrency 1)
                    applyQueue.add(async () => {
                      try {
                        if (sessionExpiredError) return;
                        if (appliedCount >= config.applyLimitPerRun) {
                          console.log(`[已達上限] 停止投遞: "${job.title}"`);
                          return;
                        }

                        console.log(`\n[實體投遞 佇列] 正在開啟 authenticated context 投遞: "${job.title}" - ${job.company}`);
                        const success = await platform.applyToJob(job.jobId, customContent.coverLetter);

                        if (success) {
                          const record: JobRecord = {
                            applyId: db.getNextApplyId(),
                            jobId: job.jobId,
                            title: job.title,
                            company: job.company,
                            location,
                            url: job.url,
                            score: evaluation.score,
                            reason: formattedReason,
                            status: 'applied',
                            coverLetter: customContent.coverLetter,
                            processedAt: getLocalTime()
                          };
                          db.addRecord(record);
                          processedInThisRun.push(record);
                          appliedCount++;
                          console.log(`[應徵成功] 已投遞第 ${appliedCount} 個職缺："${job.title}" - ${job.company}`);

                          await saveToNotion(record);

                          const delay = Math.floor(Math.random() * 10000) + 10000;
                          console.log(`等待模擬真人閱讀與操作間隔，延遲 ${delay / 1000} 秒...`);
                          await new Promise(r => setTimeout(r, delay));
                        } else {
                          console.error(`[投遞失敗] "${job.title}" - ${job.company}。記錄為 failed 以便重試。`);
                          const record: JobRecord = {
                            jobId: job.jobId,
                            title: job.title,
                            company: job.company,
                            location,
                            url: job.url,
                            score: evaluation.score,
                            reason: `投遞失敗: 流程卡住\n原分析理由: ${formattedReason}`,
                            status: 'failed',
                            processedAt: getLocalTime()
                          };
                          db.addRecord(record);
                          processedInThisRun.push(record);
                        }
                      } catch (applyErr: any) {
                        if (applyErr?.message === 'SESSION_EXPIRED') {
                          sessionExpiredError = true;
                          const fatalMsg = `🚨 <b>[自動投遞系統中途終止]</b>\n在投遞職缺 "${job.title}" 時偵測到 104 登入已過期！\n程式已立即中斷防範無效嘗試。請執行 <code>npm run login</code> 重新驗證。`;
                          console.error(`\n==================================================`);
                          console.error(`[重大錯誤] 偵測到 104 登入 Session 已過期，終止程式。`);
                          console.error(`==================================================\n`);
                          await sendTelegramMessage(fatalMsg);
                        } else {
                          console.error(`投遞過程發生例外 (${job.jobId}):`, applyErr);
                        }
                      } finally {
                        reservedSlots--;
                        inFlightJobIds.delete(job.jobId);
                      }
                    });

                  } else {
                    const skipReason = evaluation.score < config.scoreThreshold
                      ? `分數 (${evaluation.score}) 未達門檻 (${config.scoreThreshold})`
                      : `必備條件嚴重缺失 (決策: ${evaluation.decision})`;
                    console.log(`[不合適略過] ${skipReason}。`);
                    const record: JobRecord = {
                      jobId: job.jobId,
                      title: job.title,
                      company: job.company,
                      location,
                      url: job.url,
                      score: evaluation.score,
                      reason: formattedReason,
                      status: 'skipped',
                      processedAt: getLocalTime()
                    };
                    db.addRecord(record);
                    processedInThisRun.push(record);
                    inFlightJobIds.delete(job.jobId);
                  }
                } catch (aiErr) {
                  console.error(`AI 評估時發生例外 (${job.jobId}):`, aiErr);
                  inFlightJobIds.delete(job.jobId);
                }
              });

            });
          }
          
          if (shouldSwitchKeyword) {
            break;
          }
          
          pageNum++;
          if (appliedCount + reservedSlots < config.applyLimitPerRun) {
            const pageDelay = Math.floor(Math.random() * 2000) + 2000;
            console.log(`等待 ${pageDelay / 1000} 秒後搜尋下一頁...`);
            await new Promise(resolve => setTimeout(resolve, pageDelay));
          }
        } // End of while (pageNum)
      } // End of for (keyword)

      // Wait for all queued tasks to finish
      console.log('\n等待所有佇列任務 (JD/AI/Apply) 清空處理完成...');
      await jdQueue.onIdle();
      await llmQueue.onIdle();
      await applyQueue.onIdle();

      await platform.closeBrowsers();
    } // End of for (platform)

  } catch (err) {
    console.error('執行主流程時發生非預期嚴重錯誤:', err);
  } finally {
    console.log('\n正在關閉瀏覽器連線...');
    for (const platform of platforms) {
      await platform.closeBrowsers();
    }
  }

  console.log('\n==================================================');
  console.log('本次自動投遞任務完成！');
  console.log('==================================================');
  console.log(`本次共處理: ${processedInThisRun.length} 個職缺`);
  console.log(`實際成功送出應徵: ${appliedCount} 個職缺`);
  console.log(`目前歷史資料庫累計已投遞職缺數: ${db.getAppliedJobsCount()} 個`);
  console.log('==================================================');

  // Telegram Summary Report
  const appliedJobs = processedInThisRun.filter(j => j.status === 'applied');
  const failedJobs = processedInThisRun.filter(j => j.status === 'failed');
  const skippedJobs = processedInThisRun.filter(j => j.status === 'skipped');

  if (appliedJobs.length > 0 || failedJobs.length > 0) {
    let report = `<b>📊 本次投遞報告 (Pipeline 模式)</b>\n\n`;
    
    if (appliedJobs.length > 0) {
      report += `<b>✅ 成功投遞 (${appliedJobs.length})</b>\n`;
      appliedJobs.forEach(j => {
        report += `• <b>${j.title}</b> (${j.company})\n  地點: ${j.location}\n  AI 評分: ${j.score} 分\n  <a href="${j.url}">🔗 點此查看</a>\n\n`;
      });
    }

    if (failedJobs.length > 0) {
      report += `<b>❌ 投遞失敗 (${failedJobs.length})</b>\n`;
      failedJobs.forEach(j => {
        report += `• <b>${j.title}</b> (${j.company})\n  <a href="${j.url}">🔗 點此查看</a>\n\n`;
      });
    }
    
    report += `<i>總結: 處理 ${processedInThisRun.length} 筆，略過 ${skippedJobs.length} 筆。</i>`;
    await sendTelegramMessage(report);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('系統終止:', err);
  });
}

