import * as fs from 'fs';
import { Page } from 'playwright';
import { config } from '../src/config';
import { Platform104 } from '../src/platforms/platform104';
import { LLMFactory } from '../src/ai/factory';
import { JobRecord } from '../src/db';

interface TargetJobInfo {
  jobId: string;
  title: string;
  company: string;
  url: string;
  location?: string;
  source: 'specified' | 'random_apply_record';
  historicalScore?: number;
  historicalStatus?: string;
  historicalReason?: string;
}

function parseCliArgs(): { mode: 'specified' | 'random'; jobId?: string } {
  const args = process.argv.slice(2);
  const flagIndex = args.indexOf('--job-id');
  if (flagIndex !== -1 && args[flagIndex + 1]) {
    const id = args[flagIndex + 1].trim();
    if (!/^[a-zA-Z0-9]+$/.test(id)) {
      throw new Error(`無效的 Job ID 格式: "${id}"`);
    }
    return { mode: 'specified', jobId: id };
  }

  // Check positional argument or flag
  const nonFlagArgs = args.filter(a => !a.startsWith('--'));
  if (nonFlagArgs.length > 0) {
    const id = nonFlagArgs[0].trim();
    if (/^[a-zA-Z0-9]+$/.test(id)) {
      return { mode: 'specified', jobId: id };
    }
  }

  return { mode: 'random' };
}

function getAllHistoricalRecords(): JobRecord[] {
  if (!fs.existsSync(config.dbPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(config.dbPath, 'utf8');
    const data = JSON.parse(raw);
    const records: JobRecord[] = [];
    for (const date in data) {
      const day = data[date];
      // 僅抽樣 applied 分類下的已投遞職缺
      if (Array.isArray(day.applied)) {
        records.push(...day.applied);
      }
    }
    return records.filter(r => r.status === 'applied');
  } catch {
    return [];
  }
}

function selectTargetJob(excludedJobIds: Set<string> = new Set()): TargetJobInfo {
  const { mode, jobId } = parseCliArgs();
  const history = getAllHistoricalRecords();

  if (mode === 'specified' && jobId) {
    const matched = history.find(r => r.jobId === jobId);
    if (matched) {
      return {
        jobId: matched.jobId,
        title: matched.title,
        company: matched.company,
        url: matched.url || `https://www.104.com.tw/job/${matched.jobId}`,
        location: matched.location,
        source: 'specified',
        historicalScore: matched.score,
        historicalStatus: matched.status,
        historicalReason: matched.reason,
      };
    }
    return {
      jobId,
      title: '指定職缺 (待抓取 JD)',
      company: '指定公司',
      url: `https://www.104.com.tw/job/${jobId}`,
      source: 'specified',
    };
  }

  // Random sampling mode (過濾 skipped 與本次已嘗試過之職缺)
  const candidates = history.filter(
    r => r.title && r.company && r.jobId && r.status !== 'skipped' && !excludedJobIds.has(r.jobId)
  );

  if (candidates.length === 0) {
    throw new Error('未在歷史紀錄中找到可供抽樣的非略過 (non-skipped) 職缺資料。');
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    jobId: selected.jobId,
    title: selected.title,
    company: selected.company,
    url: selected.url || `https://www.104.com.tw/job/${selected.jobId}`,
    location: selected.location,
    source: 'random_apply_record',
    historicalScore: selected.score,
    historicalStatus: selected.status,
    historicalReason: selected.reason,
  };
}

async function fetchJd(target: TargetJobInfo): Promise<{ jdText: string; location: string; title: string; company: string }> {
  const platform = new Platform104();
  let detailPage: Page | null = null;

  try {
    console.log(`[1/3] 正在透過 104 讀取職缺 JD: ${target.url}...`);
    detailPage = await platform.getDetailPage();
    const result = await platform.getJobDescription(detailPage, target.url);
    return {
      jdText: result.jdText,
      location: result.location || target.location || '未知',
      title: target.title === '指定職缺 (待抓取 JD)' ? '104 職缺' : target.title,
      company: target.company === '指定公司' ? '104 徵才企業' : target.company,
    };
  } catch (err: any) {
    console.warn(`[104 讀取警告] 無法線上抓取 JD (${err?.message || err})；使用本地紀錄備份資訊...`);
    if (!target.historicalReason && target.title === '指定職缺 (待抓取 JD)') {
      throw new Error(`無法連線 104 且本地無此職缺紀錄: ${err?.message || err}`);
    }
    return {
      jdText: `職缺名稱: ${target.title}\n公司名稱: ${target.company}\n職缺說明: ${target.historicalReason || '具備相關開發經驗與技術能力。'}`,
      location: target.location || '未知',
      title: target.title,
      company: target.company,
    };
  } finally {
    if (detailPage) await platform.closePage(detailPage);
    await platform.closeBrowsers();
  }
}

async function run(): Promise<void> {
  console.log('================================================================');
  console.log('✉️  自薦信生成測試 (Cover Letter Customization Test)');
  console.log('================================================================');
  console.log(`AI Provider: ${config.aiProvider} | Model: ${config.aiModel}`);

  const { mode } = parseCliArgs();
  const excludedJobIds = new Set<string>();
  const provider = LLMFactory.getProvider();

  for (let attempt = 1; attempt <= 5; attempt++) {
    const target = selectTargetJob(excludedJobIds);
    excludedJobIds.add(target.jobId);

    console.log(`\n模式: ${target.source === 'specified' ? '🎯 指定 Job ID' : '🎲 隨機抽樣 (applyRecord.json - 已過濾 Skip)'}`);
    console.log(`Job ID  : ${target.jobId}`);
    console.log(`目標職缺: ${target.title} (${target.company})`);
    console.log(`職缺網址: ${target.url}`);
    if (target.historicalScore !== undefined) {
      console.log(`歷史紀錄: 狀態=${target.historicalStatus} | 分數=${target.historicalScore}`);
    }

    const jdData = await fetchJd(target);
    console.log(`JD 載入完成 (長度: ${jdData.jdText.length} 字，地點: ${jdData.location})\n`);

    // Step 2: Evaluation
    console.log('[2/3] 正在呼叫 AI 進行契合度與落差結構化評估...');
    const evaluation = await provider.evaluateJob(jdData.title, jdData.company, jdData.jdText);

    console.log('\n--- 🧠 AI 評估分析結果 ---');
    console.log(`Job ID: ${target.jobId}`);
    console.log(`契合度總分: ${evaluation.score} 分`);
    console.log(`決策判定 (Decision): ${evaluation.decision || 'N/A'}`);
    console.log(`優勢亮點 (Strengths):`);
    evaluation.strengths?.forEach((s, idx) => console.log(`  ${idx + 1}. ${s}`));
    if (evaluation.gaps && evaluation.gaps.length > 0) {
      console.log(`待補強領域 (Gaps):`);
      evaluation.gaps.forEach((g, idx) => console.log(`  ${idx + 1}. ${g}`));
    } else {
      console.log(`待補強領域 (Gaps): 無顯著落差`);
    }

    if (evaluation.decision === 'skip') {
      console.log(`⚠️  決策為 SKIP，依安全防護規則阻斷自薦信生成 (Job ID: ${target.jobId})。`);
      if (mode === 'specified') {
        console.log(`\n👉 重測此職缺指令: npm run test-cover-letter -- ${target.jobId}\n`);
        return;
      }
      console.log('🔄 隨機抽樣模式：自動重抽下一筆非 Skip 職缺...');
      continue;
    }

    // Step 3: Single-Shot Output Display
    const strategyName = evaluation.decision === 'maybe'
      ? 'Plan 2 - 特質遷移與弱點補強型'
      : 'Plan 1 - STAR 成就量化型';

    console.log(`\n[3/3] 單次 API 同步完成！依決策 [${evaluation.decision}] 套用「${strategyName}」...`);

    const coverLetter = (evaluation.coverLetter || '').trim();

    console.log('\n================================================================');
    console.log(`📄 生成的客製化自薦信 (Job ID: ${target.jobId})`);
    console.log('================================================================');
    console.log(coverLetter);
    console.log('================================================================');
    console.log('📊 測試摘要與重測指令');
    console.log(`- Job ID        : ${target.jobId}`);
    console.log(`- 職缺／公司    : ${jdData.title} | ${jdData.company}`);
    console.log(`- AI 決策／分數 : ${evaluation.decision} (${evaluation.score} 分)`);
    console.log(`- 採用路由策略  : ${strategyName}`);
    console.log(`- 自薦信長度    : ${coverLetter.length} 字`);
    console.log(`- API 呼叫次數  : 1 次 (One-Shot Unified)`);
    console.log(`\n👉 如需再次測試此職缺，請執行：`);
    console.log(`   npm run test-cover-letter -- ${target.jobId}`);
    console.log('================================================================\n');
    return;
  }
}

run().catch(error => {
  console.error('\n❌ 自薦信生成測試失敗:', error);
  process.exit(1);
});
