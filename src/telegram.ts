import { config } from './config';

let chatId = config.telegramChatId;

export async function sendTelegramMessage(message: string) {
  if (!config.telegramBotToken) {
    return;
  }

  try {
    // If we don't have a chat ID, try to fetch it from recent updates
    if (!chatId) {
      const updatesResponse = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getUpdates`);
      const updatesData = await updatesResponse.json();
      if (updatesData.ok && updatesData.result.length > 0) {
        // Get the latest message's chat ID
        chatId = updatesData.result[updatesData.result.length - 1].message.chat.id.toString();
        console.log(`[Telegram] 成功自動獲取 Chat ID: ${chatId}`);
        // Save back to .env to prevent forgetting
        try {
          const fs = require('fs');
          const path = require('path');
          const envPath = path.resolve(__dirname, '..', '.env');
          let envContent = fs.readFileSync(envPath, 'utf8');
          if (envContent.includes('TELEGRAM_CHAT_ID=')) {
            envContent = envContent.replace(/TELEGRAM_CHAT_ID=.*/, `TELEGRAM_CHAT_ID=${chatId}`);
          } else {
            envContent += `\
TELEGRAM_CHAT_ID=${chatId}\
`;
          }
          fs.writeFileSync(envPath, envContent);
          console.log('[Telegram] 已將 Chat ID 永久儲存至 .env 檔案');
        } catch(e) {}
      } else {
        console.warn('[Telegram] 無法獲取 Chat ID。請確保您已先傳送隨便一則訊息給機器人。');
        return;
      }
    }

    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      console.error('[Telegram] 發送失敗:', await response.text());
    }
  } catch (error) {
    console.error('[Telegram] 發送時發生例外錯誤:', error);
  }
}
