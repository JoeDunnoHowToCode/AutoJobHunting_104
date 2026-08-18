# 🚀 Auto-Job-Hunter (全自動 AI 履歷投遞引擎)

這是一個以 Node.js、Playwright 與 Multi-LLM AI Engine (Gemini, OpenAI, OpenRouter, Ollama) 為核心開發的「全自動化求職助理」。
目前系統已支援 **104 人力銀行**，未來將以微服務外掛架構陸續支援 CakeResume、Yourator、1111 等各大求職平台！
系統會根據您的個人履歷 (`resume.json`)，自動在平台上搜尋職缺、透過 AI 評估適合度、自動撰寫客製化自薦信，並直接完成應徵。您甚至能透過 Telegram 接收即時投遞戰報！以及寫入 **Notion 資料庫** 歸檔。

---

## 🛠️ 核心特色與技術架構

* **高效率尋缺引擎**：依職缺相關性 (`order=12`) 進行精準排序，避開廠商每日刷新日期的搜尋干擾，高效搜尋關鍵字契合度最高的新職缺。
* **智慧關鍵字輪替**：從履歷提取期望職稱隨機搜尋，搜尋至第 2 頁且連續遇到 25 個已處理職缺時，自動切換至下一個關鍵字。
* **多平台 AI 支援與 BYOK (Bring Your Own Key)**：支援 **Gemini, OpenAI (GPT-4o/DeepSeek), OpenRouter, Ollama (本地免金鑰)** 多種 LLM 引擎。金鑰安全留存於 `.env`，設定檔 `settings.json` 提供單一 `aiModel` 通用變數，輕鬆彈性切換模型！
* **AI 智慧評估與 Zod 驗證**：透過 Zod Schema 進行加權評估（技能、經驗、領域、學歷、加分），產出決策 (APPLY/MAYBE/SKIP)、信心度、優勢亮點與缺口補強。搭載 Prompt Injection 防範機制，並支援薪資區間上限精準解析。
* **評估上下文鏈接自薦信**：自動將 AI 評估產出的「優勢亮點」與「缺口補強」注入自薦信 Prompt，針對職缺需求精準條列強項並適度補充弱點。
* **雙軌即時回報系統**：
    * 投遞進度與 AI 評估分數即時推播至 **Telegram**。
    * 歷史紀錄完整歸檔至 **Notion Database**。
* **智慧持久化去重 (14天過期機制)**：`applyRecord.json` 確保已投遞職缺不再重複投遞。因門檻未達略過 (`skipped`) 的職缺，14 天後自動解鎖重新評估。
* **微服務外掛架構**：程式已重構為模組化架構（`src/platforms/` 與 `src/ai/`），只需擴充模組即可輕易支援各種新求職網站與 LLM 模型！

---

## 📂 專案設定與使用指南

為了確保隱私安全與設定彈性，本專案將「機密資料」與「一般設定」完全分離：

### 第一步：設定隱私金鑰 (`.env`)
專案中包含了您的各式金鑰，**請複製 `.env.example` 並重新命名為 `.env`**。
由於 `.gitignore` 已將其排除，您的金鑰絕對不會外洩到 GitHub。
```env
# Google Gemini API 金鑰： https://aistudio.google.com/api-keys
GEMINI_API_KEY=YOUR_GEMINI_API_KEY

# OpenAI API 金鑰： https://platform.openai.com/api-keys
OPENAI_API_KEY=YOUR_OPENAI_API_KEY

# OpenRouter API 金鑰： https://openrouter.ai/workspaces/default/keys
OPENROUTER_API_KEY=YOUR_OPENROUTER_API_KEY

# Ollama 本地 API 位置 
OLLAMA_BASE_URL=http://localhost:11434

# Telegram 通知 Bot Token (由 @BotFather 取得)
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
# 請先發送訊息給您的 Bot，系統啟動時會自動抓取 Chat ID，或者您也可以手動填寫
TELEGRAM_CHAT_ID=

# Notion 紀錄整合
NOTION_API_TOKEN=YOUR_NOTION_INTEGRATION_TOKEN
NOTION_DATABASE_ID=YOUR_NOTION_DATABASE_ID
```
> 💡 **小貼士（可選功能）**：
> - **Telegram 與 Notion 為可選服務**：若您暫時不需要推播或 Notion 歸檔，只需在 `.env` 中將其留空即可。系統會自動切換至靜默模式，所有投遞紀錄皆會完整儲存於本地 `applyRecord.json`。
> - `TELEGRAM_CHAT_ID` 您可以留空。系統啟動時，只要您先傳送隨便一句話給您的 Telegram 機器人，系統就會自動捕捉您的 Chat ID 並寫回 `.env` 永久記住！

### 第二步：調整運作參數 (`settings.json`)
這裡存放與隱私無關的一般設定，您可以直接修改此檔案（您可以參考 `settings_example.json`）：
```json
{
  "aiProvider": "gemini",          // 可選: "gemini" | "openai" | "openrouter" | "ollama"
  "aiModel": "gemini-flash-lite-latest", // 單一通用模型名稱 (例: gemini-flash-lite-latest, gpt-4o-mini, anthropic/claude-3.5-sonnet, 可以到API介面查看模型名稱)
  "scoreThreshold": 65,            // 契合度大於等於此分數才會自動投遞
  "applyLimitPerRun": 30,          // 單次腳本執行的最大投遞數量上限
  "blacklistKeywords": ["保險", "博弈"],  // 遇到這些關鍵字直接略過不看
  
  // 地點篩選 (可複選)，若不限制請填 []
  // 支援的地點清單，可直接複製貼上：
  // "台北市", "新北市", "基隆市", "桃園市", "新竹縣", "新竹市", "苗栗縣", "台中市", "彰化縣", "南投縣", "雲林縣", "嘉義縣", "嘉義市", "台南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "台東縣", "澎湖縣", "金門縣", "連江縣"
  "areas": ["台北市", "新北市"]
}
```

> 💡 **AI 契合度評分標準與建議門檻設定 (`scoreThreshold`)**：
>
> 系統採用 100 分滿分制的客觀加權量表進行評估：
> - **1. 技能重合度 (0-40分)**：比對 JD 要求的程式語言、框架、工具與履歷明確記載的技能。
> - **2. 經驗契合度 (0-25分)**：比對 JD 要求的年資、產業經驗與實際工作經歷。
> - **3. 領域契合度 (0-15分)**：評估是否具備該產業領域（如金融、電商、AI 等）的知識或背景。
> - **4. 加分項契合度 (0-15分)**：語言能力 (如多益英文)、專業證照或特殊加分條件。
> - **5. 學歷門檻 (0-5分)**：比對學歷要求。
>
> **分數門檻 (`scoreThreshold`) 設定建議**：
> - **75 ~ 80 分 (高精準 / 高面試率)**：適合追求高面試轉換率，僅投遞實力高度匹配的職缺。
> - **65 ~ 70 分 (預設推薦 / 平衡投遞)**：適合積極尋找新機會，只要核心技能與經驗吻合即自動應徵。
> - **55 ~ 60 分 (廣發 / 跨領域轉職)**：適合跨領域轉職或想儘可能爭取面試機會的使用者。

### 第三步：填寫個人履歷 (`resume.json`)
系統的「搜尋關鍵字」與「AI 評分標準」全靠這份檔案。
1. 請複製專案內的 `resume_example.json` 並將其重新命名為 `resume.json`。
2. 將裡面的 John Doe 假資料替換為您真實的經歷、技能。
3. 最重要的是設定您的期望職稱 (`desired_title`)及期望薪資 (`expected_salary_monthly`)，系統會自動把它當作 104 搜尋引擎的關鍵字以及篩選的標準！

### 第四步：手動登入 104 並儲存 Session
因為 104 登入有圖形驗證碼，請由使用者手動登入：
1. 終端機執行：`npm run login`
2. 此步驟會啟動可見的正式 Chrome 並開啟 104 首頁。請在視窗內手動完成登入程序（包含平台要求的驗證）。登入完成後，回到終端機按下 `Enter`，系統只會將 **104 網域**的狀態儲存到本地 `auth_state.json`，不保存無關第三方網站資料。
3. 儲存後先執行 `npm run preflight-104:review -- <jobId>`。後台頁面回應 200 只代表 Session 尚可登入，**不保證**自動化 Context 可存取職缺或應徵表單；若 preflight 顯示 403、驗證或限流，請停止，不要重試或試圖改變瀏覽器特徵。

---

## 🌟 新手首次使用流暢度指南 (First-Time Tips)

1. **快速驗證 API 金鑰與 LLM 配置 (無痛測試)**：
   在執行完整瀏覽器流程前，可先執行以下測試指令：
   ```bash
   npm run test-ai
   ```
   系統會測試當前 `settings.json` 指定的 AI Provider／模型之連線、契合度評估與自薦信生成。此為線上測試，會將履歷摘要傳送給該 LLM 服務，請只在您同意該資料處理時執行。

2. **104 一律使用可見的正式 Chrome**：
   104 的 JD 在背景模式會回傳 HTTP 403，因此搜尋、JD 與應徵流程會固定啟動本機已安裝的 Google Chrome 並保持可見。這是平台相容性限制，不使用 stealth、假 User-Agent 或規避機制；請勿將它改回背景模式。

3. **登入憑證與表單存取是兩件事**：
   `auth_state.json` 只是一份本機登入狀態快照；後台驗證成功不等同每個 104 頁面都會允許自動化 Context 存取。重新手動登入後務必先通過單筆 `preflight-104:review`；若收到 403／驗證／限流，停止流程並以一般手動瀏覽器處理，不要反覆重試或採用 stealth、代理、假 User-Agent 等規避方法。

---

## 🚀 執行與部署

### ⚡ 立即執行自動投遞
```bash
npm start
```
系統將會：
1. 讀取您的 `resume.json` 中的 `desired_title` 開始搜尋最新職缺。
2. 逐一比對 JD，透過指定 AI 模型 (Gemini / OpenAI / OpenRouter / Ollama) 給出評估。
3. 分數達標且通過薪資/黑名單過濾後自動投遞。
4. 將結果發送至 Telegram 並記錄至 Notion。

### 🧪 應徵前唯讀驗證（建議先執行）
```bash
npm run dry-run
```

這個模式會使用既有的 104 Session 跑完整的「搜尋 → JD → AI 評估 → 自薦信生成 → 開啟應徵表單」流程，但最多只處理一個非黑名單候選職缺，並在最終送出前停止。104 流程固定以可見 Chrome 執行，並具有以下硬性限制：

* dry-run 呼叫的是獨立的 `preflightApplication(...)`，不會呼叫正式的 `applyToJob(...)`。
* 不填入自薦信、不勾選同意／偏好選項、不點擊最終送出按鈕。
* 不寫入 `applyRecord.json`、Notion 或 Telegram；資料庫以唯讀方式開啟，程式層也拒絕任何寫入。
* 搜尋或應徵頁遇到登入失效、驗證頁、429／403 或其他平台限制時立即停止，不嘗試規避或重試。
* JD、搜尋或應徵頁遇到 HTTP 403 時都會在第一筆停止；不會把限制頁當 JD 傳給 LLM，也不會繼續掃描其他職缺。

`npm run dry-run:headed` 保留為相容別名；104 本來就會開啟可見 Chrome。若要在表單開啟且檢查完成後停住，執行 `npm run dry-run:review`，然後只按 Enter 關閉表單；此模式同樣不會填寫、勾選或送出。

若只需重驗已知職缺的送出前表單、且不希望將履歷與 JD 交給外部 LLM，可使用更窄的唯讀檢查：

```bash
npm run preflight-104:review -- 8kbs5
```

它要求明確指定一個 job ID，只會驗證保存的 Session 並開啟該職缺的送出前表單。它不搜尋、不讀取履歷、不呼叫 LLM、不寫入 `applyRecord.json`、Notion 或 Telegram，也不填寫、勾選或送出；執行時停在表單供人工檢查，按 Enter 關閉。

### 104 連線診斷（唯讀）

```bash
npm run diagnose-104:headed
# 對已知職缺做最小 JD 對照（不搜尋、不開表單）
npm run diagnose-104:job -- 8x8yl
```

診斷只驗證登入、公開搜尋與 JD，輸出會去除 query、Cookie、履歷與自薦信內容。專案預設使用本機正式 Google Chrome；若未安裝，請先安裝 Chrome，勿以 stealth 或假瀏覽器資訊取代。

> 注意：開啟「我要應徵」表單本身仍是對 104 的真實互動，平台可能記錄該頁面瀏覽或表單開啟事件；dry-run 只能保證本程式不會傳送履歷內容或完成投遞，不能保證平台端完全沒有觀測紀錄。

---

## 🧪 測試方式與驗證項目 (Testing Suite)

本專案提供涵蓋單元測試、LLM 冒煙測試至端對端表單預檢的多層級測試架構：

### 1. 離線單元測試 (Unit Tests - 快速且無需 API / 網路)

| 測試指令 | 測試目標與驗證項目 |
| :--- | :--- |
| `npm run test-prompts` (或 `npm test -- src/prompts.spec.ts`) | **自薦信雙軌動態路由與 Guardrails 測試**：驗證 `apply` (Plan 1 - STAR 量化型)、`maybe` (Plan 2 - 特質遷移型)、`skip` 阻斷防護、Context 注入與 5 大硬性防護規則。 |
| `npm run test-pipeline` | **Pipeline 滑動窗口與佇列控制**：驗證 DB O(1) 索引去重、`PipelineState` 併發鎖與 `reserveApply` 名額保留、`applyQueue` 嚴格單線、以及 LLM 暫時性錯誤指數退避重試。 |
| `npm run test-application-action` | **應徵分流與唯讀隔離**：驗證 `--dry-run` 唯讀模式與 `live` 正式模式的 API 邊界隔離，確保 dry-run 絕不呼叫正式送出方法且不寫入 DB。 |
| `npm run test-session-state` | **Session 快照與 Cookie 最小化**：驗證僅保存 104 官方主網域與登入子網域之憑證，嚴格過濾第三方追蹤與偽冒網域。 |
| `npm run test-preflight-104` | **單筆 Preflight 安全邊界**：驗證表單預檢必須傳入明確 Job ID，且全程不讀取履歷、不呼叫 LLM、不寫入 DB。 |
| `npm run test-104-platform` | **104 平台解析器**：驗證 104 職缺搜尋、詳情頁 JD 擷取與表單狀態解析邏輯。 |

### 2. 線上冒煙與自薦信生成測試 (Online AI Tests)

* `npm run test-cover-letter`：**自薦信客製化生成測試**（支援兩大模式）。
  * **模式 1（指定職缺）**：`npm run test-cover-letter -- <jobId>`（例如 `npm run test-cover-letter -- 93csc`）
  * **模式 2（隨機抽樣）**：`npm run test-cover-letter`（自動自 `applyRecord.json` 隨機抽取過往職缺進行即時生成驗證）
  * **驗證重點**：即時輸出 AI 評估分數、決策結果 (`apply`/`maybe`/`skip`)、優勢亮點、待補強領域，以及動態切換之自薦信風格（Plan 1 STAR 量化型 vs Plan 2 特質遷移型）與字數統計。
* `npm run test-ai`：**LLM API 基礎連線測試**（驗證目前設定的模型基本連線與輸出結構）。

### 3. 端對端唯讀預檢 (E2E Preflight & Review)

* `npm run dry-run`：**全流程唯讀執行**（搜尋 → JD → AI 評估 → 自薦信生成 → 開啟表單預檢；不填寫、不勾選、不送出、不寫入資料庫）。
* `npm run dry-run:review`：**人工表單檢查模式**（於 Chrome 視窗停留在真實表單供肉眼核對，按 Enter 安全關閉）。
* `npm run preflight-104:review -- <jobId>`：**指定單一職缺表單檢查**。

### ⏰ 排程自動化
可以將指令加入系統排程（如 `crontab`）中，讓機器人每天定時為您搜尋並投遞新職缺。
```bash
# 每天早上 9 點自動執行一次
0 9 * * * cd /您的路徑/auto-job-hunter && npm run start >> /tmp/auto-job.log 2>&1
```

---

## 🚀 取得專案與安裝
```bash
git clone https://github.com/您的帳號/auto-job-hunter.git
cd auto-job-hunter
npm install
```

## 🛡️ 平台限制與安全機制

* **.gitignore 嚴密保護**：您的履歷 (`resume.json`)、投遞軌跡 (`applyRecord.json`) 以及密碼金鑰 (`.env`) 皆不會被上傳。
* **保守序列投遞**：實體投遞固定一次一筆，成功後保留 10–20 秒間隔；這僅是節制系統負載，不保證、也不應被視為規避平台偵測的方法。
* **應徵前安全驗證**：`npm run dry-run` 用獨立的唯讀表單檢查路徑驗證流程；其不會填寫、勾選或送出，且不會產生本地或外部紀錄。
* **限制處理**：遇到登入過期、驗證碼、429 或其他存取限制時，應停止操作並重新以平台允許的方式驗證；不嘗試繞過限制。
* **防重複投遞**：系統紀錄了完整的歷史檔案，一旦看過就不會再浪費時間重新分析，效率極高。
