/**
 * messenger.ts — Unified outbound message sender.
 * All agents send through here. Currently delivers via Telegram.
 */
import { sendTelegram } from './triggers/telegram';
import { config } from './config';

/** Send a message to the user (always goes to Telegram) */
export async function sendMessage(text: string): Promise<void> {
  await sendTelegram(config.user.telegramChatId, text);
}
