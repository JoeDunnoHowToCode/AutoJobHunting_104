---
status: accepted
---

# 用 cross-env 讓強制開視窗的 npm 指令跨平台執行

這個決定約束 `package.json` 中 6 個強制開視窗的指令（`dry-run:headed`、`dry-run:review`、`diagnose-104:headed`、`diagnose-104:job`、`preflight-104:review`、`inspect-apply`），以及 `tests/preflight-104.spec.ts`。

## Context

這 6 個指令以 POSIX 寫法 `AUTOJOB_HEADLESS=false` 開頭，強制瀏覽器開視窗。Windows 的 npm 預設用 cmd.exe 執行指令（npm 文件 `config.md` 的 `script-shell`），cmd.exe 看不懂這種寫法，指令會直接失敗。開不開視窗的優先順序是環境變數、`settings.json`、預設 `false`（`src/config.ts`），而環境變數只接受完全等於 `true` 或 `false` 的值，所以 cmd 的 `set AUTOJOB_HEADLESS=false && ...` 也不能用，因為它會在值後面留下空白。`tests/preflight-104.spec.ts` 鎖住 `preflight-104:review` 必須強制開視窗。

## Options

**A. repo 不動，各台 Windows 把 npm 的 `script-shell` 改成 Git Bash。** repo 零改動，但會影響整台電腦的所有 npm 專案，別人 clone 後也要自己設定。只要有其他人在 Windows 上使用，這個選項就是錯的。

**B. 拿掉前綴，靠預設值開視窗。** 只要改 6 行指令和 1 行測試，但會失去「檢查用的指令一定開視窗」這個保證：`settings.json` 設成 `headless: true` 時，`dry-run:review` 會直接關掉表單，`preflight-104:review` 與 `inspect-apply` 會對著看不見的瀏覽器等候輸入，而且都不會報錯。只要會用 headless 排程，這個選項就是錯的。

**C. 程式認得 `--headed` 參數並強制開視窗。** 不加套件，但 `config.ts` 的優先順序會多一層，而且 `--headed` 必須放在 `--job-id` 前面。不想為了幾個指令在程式裡多一個開關時，這個選項就是錯的。

**D. 加入 cross-env（devDependency）。** 指令寫法和行為與原本相同，在 Windows、macOS、Linux 都能執行。代價是多一個第三方套件，`package-lock.json` 也會跟著變動。希望盡量少依賴第三方套件，或 cross-env 停止維護時，這個選項就是錯的。

## Decision

選 D。依據使用者的回答：「我希望未來可以宣傳給別人用」，排除 A；「正式跑的話我想要不開視窗跑排程」，排除 B；對於多一個第三方套件，回答「可以」，所以在 C 與 D 之間選 D。

## Consequences

- 變容易：這 6 個指令在 Windows、macOS、Linux 都能直接執行；檢查用的指令不受 `settings.json` 的 `headless` 影響，一定開視窗。
- 變困難：多一個 devDependency（cross-env 10.x，需要 Node 20 以上），之後要跟著升級，也要注意供應鏈風險。
- 需要重新討論的情況：cross-env 停止維護或出現安全問題，或這些指令改成用別的方式啟動。
