import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { orchestrator } from '../pipeline/orchestrator';
import { signalIngest } from '../agents/signalIngest';

let bot: TelegramBot | null = null;

export function getTelegramBot(): TelegramBot {
  if (!bot) {
    bot = new TelegramBot(config.telegram.botToken, { polling: true });
    setupTelegramListeners(bot);
    console.log('[Telegram] Bot started with long-polling');
  }
  return bot;
}

export async function sendTelegram(chatId: string | number, text: string): Promise<void> {
  const b = getTelegramBot();
  await b.sendMessage(Number(chatId), text, { parse_mode: 'Markdown' });
}

function setupTelegramListeners(b: TelegramBot): void {
  b.on('message', async (msg) => {
    const text = msg.text ?? '';
    const chatId = msg.chat.id;

    if (!text) return;

    // Only respond to the configured user
    if (config.user.telegramChatId && String(chatId) !== config.user.telegramChatId) {
      console.warn(`[Telegram] Ignoring message from unknown chat: ${chatId}`);
      return;
    }

    console.log(`[Telegram] Incoming from ${chatId}: ${text.slice(0, 100)}`);

    const signal = signalIngest.fromTelegram(text, chatId, {
      message_id: msg.message_id,
      first_name: msg.from?.first_name,
    });

    await orchestrator.process(signal);
  });

  b.on('polling_error', (err) => {
    console.error('[Telegram] Polling error:', err.message);
  });
}
