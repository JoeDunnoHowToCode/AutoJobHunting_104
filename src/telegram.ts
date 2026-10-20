import { config } from './config';

interface TelegramChat {
  id: number;
  type: string;
  username?: string;
  first_name?: string;
}

/**
 * Lists the private chats that have messaged the bot, newest first.
 *
 * Updates are not all messages (edited messages, membership changes, …), so a
 * missing `message` must be skipped rather than dereferenced. Group chats are
 * excluded: the summary carries cover letters and scores, which have no business
 * landing in a group someone added the bot to.
 */
export function findPrivateChats(updates: unknown[]): TelegramChat[] {
  const seen = new Map<number, TelegramChat>();
  for (const update of [...updates].reverse()) {
    const u = update as { message?: { chat?: TelegramChat }; edited_message?: { chat?: TelegramChat } };
    const chat = u.message?.chat ?? u.edited_message?.chat;
    if (chat && chat.type === 'private' && typeof chat.id === 'number' && !seen.has(chat.id)) {
      seen.set(chat.id, chat);
    }
  }
  return [...seen.values()];
}

let missingChatIdReported = false;

/**
 * Never adopts a chat ID on its own. Whoever messaged the bot most recently is
 * not necessarily its owner, and silently writing that ID into .env would route
 * every future report to them. Print the candidates and let the user choose.
 */
async function reportMissingChatId(): Promise<void> {
  if (missingChatIdReported) return;
  missingChatIdReported = true;
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getUpdates`);
    const data = await response.json();
    const chats = data.ok && Array.isArray(data.result) ? findPrivateChats(data.result) : [];
    if (chats.length === 0) {
      console.warn('[Telegram] 未設定 TELEGRAM_CHAT_ID，且找不到私訊過 Bot 的對話。請先私訊您的 Bot 一則訊息，再重新執行。');
      return;
    }
    console.warn('[Telegram] 未設定 TELEGRAM_CHAT_ID，本次不發送通知。以下是最近私訊過 Bot 的對話，請確認哪一個是您本人後填入 .env：');
    for (const chat of chats) {
      const name = chat.username ? `@${chat.username}` : chat.first_name ?? '(無名稱)';
      console.warn(`  TELEGRAM_CHAT_ID=${chat.id}   # ${name}`);
    }
  } catch (error) {
    console.warn('[Telegram] 未設定 TELEGRAM_CHAT_ID，且查詢候選對話失敗:', error);
  }
}

export async function sendTelegramMessage(message: string) {
  if (!config.telegramBotToken) {
    return;
  }

  if (!config.telegramChatId) {
    await reportMissingChatId();
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: config.telegramChatId,
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
