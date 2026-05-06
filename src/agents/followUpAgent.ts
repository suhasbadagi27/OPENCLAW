import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ScoredEvent } from '../types';
import { sendMessage } from '../messenger';
import { memSet, memGet } from '../context/memory';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SUMMARIZER_PROMPT = `You are a personal assistant summarizing a completed meeting.
Based on the meeting details provided, create:
1. A concise 3–5 sentence summary of likely discussion points
2. A bullet list of 3–5 likely action items

Format:
SUMMARY:
<summary here>

ACTION ITEMS:
• <item 1>
• <item 2>
• ...

Keep it practical and professional.`;

/** Agent 7 — Follow-up Agent
 *
 * Fires 5–10 minutes after a meeting ends.
 * Prompts the user via Telegram, then delivers summary + action items.
 */
export class FollowUpAgent {
  readonly name = 'FollowUpAgent';

  scheduleFollowUp(event: ScoredEvent): void {
    const endTime = new Date(event.end);
    const promptTime = new Date(endTime.getTime() + 5 * 60 * 1000);
    const msUntilPrompt = promptTime.getTime() - Date.now();

    if (msUntilPrompt <= 0) return;

    console.log(
      `[FollowUpAgent] Scheduled follow-up for "${event.title}" at ${promptTime.toLocaleTimeString()}`
    );

    setTimeout(async () => {
      await this.sendFollowUpPrompt(event);
    }, msUntilPrompt);
  }

  private async sendFollowUpPrompt(event: ScoredEvent): Promise<void> {
    await memSet(`followup:pending:${event.id}`, event, 3600);

    const message = [
      `✅ *${event.title}* just ended.`,
      ``,
      `Want a meeting summary and action items?`,
      `Reply *SUMMARY ${event.id.slice(0, 8)}* for an AI summary.`,
      `Reply *SKIP ${event.id.slice(0, 8)}* to dismiss.`,
    ].join('\n');

    await sendMessage(message);
    console.log(`[FollowUpAgent] Sent follow-up prompt for ${event.title}`);
  }

  async generateSummary(eventId: string): Promise<void> {
    const event = await memGet<ScoredEvent>(`followup:pending:${eventId}`);
    if (!event) {
      await sendMessage('❓ Meeting not found or already dismissed.');
      return;
    }

    console.log(`[FollowUpAgent] Generating summary for ${event.title}...`);

    const meetingContext = [
      `Meeting: ${event.title}`,
      `Time: ${new Date(event.start).toLocaleString()} – ${new Date(event.end).toLocaleString()}`,
      event.location ? `Location: ${event.location}` : `Virtual meeting`,
      event.conference_link ? `Conference: ${event.conference_link}` : '',
      `Attendees: ${event.attendee_count}`,
      `Priority: ${event.priority}`,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SUMMARIZER_PROMPT,
      messages: [{ role: 'user', content: meetingContext }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('[FollowUpAgent] Unexpected Claude response');

    const summaryMessage = [
      `📋 *Meeting Summary — ${event.title}*`,
      ``,
      content.text,
      ``,
      `_Reply *DONE* to mark all items as completed._`,
    ].join('\n');

    await sendMessage(summaryMessage);
    console.log(`[FollowUpAgent] Summary sent for ${event.title}`);
  }
}

export const followUpAgent = new FollowUpAgent();
