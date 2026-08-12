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
  "headless": true,                // true=背景隱藏執行, false=會跳出瀏覽器畫面
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
因為 104 登入有圖形驗證碼，您只需要手動登入一次：
1. 終端機執行：`npm run login`
2. 此步驟會啟動瀏覽器為您開啟 104 首頁。請在視窗內手動完成 104 的登入程序（包含圖片驗證碼）。登入完成後，回到終端機按下 `Enter`，系統會將 104 的 Session 儲存至本地的 `auth_state.json` 檔案中，之後就會全自動免登入。

---

## 🌟 新手首次使用流暢度指南 (First-Time Tips)

1. **快速驗證 API 金鑰與 LLM 配置 (無痛測試)**：
   在執行完整瀏覽器流程前，可先執行以下測試指令：
   ```bash
   npm run test-ai
   ```
   系統會在 5 秒內測試當前 `settings.json` 指定之 AI 金鑰連線、契合度評估與自薦信生成，確認 API 設定 100% 正確。

2. **首次執行建議啟用有頭模式 (`headless: false`)**：
   第一次執行 `npm start` 時，建議在 `settings.json` 中設定 `"headless": false`。您可以直觀看到瀏覽器自動搜尋、捲動頁面、評估與填寫自薦信的全過程，確認一切無誤後再改回 `true` 進行背景隱藏執行。

3. **登入憑證有效性**：
   手動登入 (`npm run login`) 生成的 `auth_state.json` 憑證通常可維持數週。若系統日誌提示 `Session 已過期`，只需重新執行一次 `npm run login` 即可快速完成更新。

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

## 🛡️ 反爬蟲防護與安全機制

* **.gitignore 嚴密保護**：您的履歷 (`resume.json`)、投遞軌跡 (`applyRecord.json`) 以及密碼金鑰 (`.env`) 皆不會被上傳。
* **真人行為模擬**：每次爬取與點擊皆有隨機秒數延遲，並搭載 `stealth` 技術規避 Cloudflare 機器人偵測。
* **防重複投遞**：系統紀錄了完整的歷史檔案，一旦看過就不會再浪費時間重新分析，效率極高。
