import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { Signal } from '../types';
import { storeApprovalState } from '../context/memory';
import { sendMessage } from '../messenger';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const DRAFTER_PROMPT = `You are a professional personal assistant drafting replies on behalf of the user.
Write a polite, clear, and concise reply to the incoming message.
Keep it under 5 sentences. Use a professional but friendly tone.
Return ONLY the reply text — no preamble, no subject line.`;

/** Agent 6 — Auto Responder
 *
 * Drafts a reply to meeting invites or messages needing a response.
 * Sends the draft via Telegram for user approval before sending.
 */
export class AutoResponderAgent {
  readonly name = 'AutoResponder';

  async handle(signal: Signal, context?: string): Promise<void> {
    console.log('[AutoResponder] Drafting reply...');

    const userMessage = [
      `Original message:`,
      signal.raw_text,
      context ? `\nContext: ${context}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: DRAFTER_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('[AutoResponder] Unexpected Claude response type');

    const draft = content.text.trim();
    const approvalId = uuidv4();
    const shortId = approvalId.slice(0, 8);

    await storeApprovalState(
      approvalId,
      {
        id: approvalId,
        type: 'auto_reply',
        draft,
        context: {
          original_signal_id: signal.id,
          source: signal.source,
          sender_id: signal.sender_id,
        },
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      },
      3600
    );

    // Also store by short ID for easy lookup
    await storeApprovalState(`short:${shortId}`, approvalId, 3600);

    const approvalMessage = [
      `📝 *Draft Reply — Waiting for Approval*`,
      ``,
      `_Original:_`,
      `> ${signal.raw_text.slice(0, 200)}${signal.raw_text.length > 200 ? '...' : ''}`,
      ``,
      `_Suggested reply:_`,
      draft,
      ``,
      `Reply:`,
      `✅ *SEND ${shortId}* to send this`,
      `✏️ *EDIT ${shortId} <your text>* to send custom reply`,
      `❌ *SKIP ${shortId}* to discard`,
    ].join('\n');

    await sendMessage(approvalMessage);
    console.log(`[AutoResponder] Draft sent via Telegram, approval ID: ${shortId}`);
  }
}

export const autoResponder = new AutoResponderAgent();
