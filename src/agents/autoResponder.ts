import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { Signal } from '../types';
import { storeApprovalState } from '../context/memory';
import { sendMessage } from '../messenger';
import fmt from '../utils/fmt';

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

    // ─── Compute expiry label ──────────────────────────────────────────────
    const expiresAt = new Date(Date.now() + 3600 * 1000);
    const expiryStr = expiresAt.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.user.timezone,
    });

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
        expires_at: expiresAt.toISOString(),
      },
      3600
    );

    // Also store by short ID for easy lookup
    await storeApprovalState(`short:${shortId}`, approvalId, 3600);

    // ─── Source label ──────────────────────────────────────────────────────
    const sourceLabel =
      signal.source === 'email'
        ? 'Email'
        : signal.source === 'telegram'
        ? 'Telegram message'
        : signal.source.charAt(0).toUpperCase() + signal.source.slice(1);

    await sendMessage(
      fmt.build(
        fmt.header('📝  Draft Reply — Awaiting Your Approval'),
        `  ID: ${fmt.bold(shortId)}  ·  Expires at ${expiryStr}`,
        '',
        fmt.divider(),
        `*Original ${sourceLabel}*`,
        fmt.quote(signal.raw_text.slice(0, 220)),
        '',
        fmt.divider(),
        '*Suggested Reply*',
        `  ${draft}`,
        fmt.divider(),
        '',
        '*What would you like to do?*',
        '',
        `  ✅  *SEND ${shortId}*${' '.repeat(6)}Send this reply as-is`,
        `  ✏️  *EDIT ${shortId}* _<text>_   Send your own text instead`,
        `  ❌  *SKIP ${shortId}*${' '.repeat(6)}Discard — no reply will be sent`,
        '',
        fmt.footer(`This draft will auto-expire at ${expiryStr}.`)
      )
    );

    console.log(`[AutoResponder] Draft sent via Telegram, approval ID: ${shortId}`);
  }
}

export const autoResponder = new AutoResponderAgent();
