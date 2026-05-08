import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { ScoredEvent } from '../types';
import { sendMessage } from '../messenger';
import { memSet, memGet } from '../context/memory';
import fmt from '../utils/fmt';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SUMMARIZER_PROMPT = `You are a personal assistant summarizing a completed meeting.
Based on the meeting details provided, create:
1. A concise 3–5 sentence summary of likely discussion points
2. A bullet list of 3–5 likely action items

Format your response EXACTLY as:
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

    const startTime = new Date(event.start).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.user.timezone,
    });
    const endTime = new Date(event.end).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.user.timezone,
    });

    // Calculate duration
    const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
    const durationMin = Math.round(durationMs / 60000);
    const durationLabel =
      durationMin >= 60
        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}min`
        : `${durationMin} min`;

    const shortId = event.id.slice(0, 8);

    await sendMessage(
      fmt.build(
        fmt.header('✅  Meeting Complete', event.title),
        '',
        fmt.field('Time', `${startTime} – ${endTime}`),
        fmt.field('Duration', durationLabel),
        event.location ? fmt.field('Location', event.location) : '',
        fmt.field('Priority', event.priority),
        '',
        fmt.divider(),
        '*What\'s next?*',
        '',
        `  📋  *SUMMARY ${shortId}*   Generate an AI summary with action items`,
        `  ⏭️  *SKIP ${shortId}*      Dismiss without a summary`,
        '',
        fmt.footer('This prompt expires in 1 hour.')
      )
    );

    console.log(`[FollowUpAgent] Sent follow-up prompt for ${event.title}`);
  }

  async generateSummary(shortEventId: string): Promise<void> {
    const event = await memGet<ScoredEvent>(`followup:pending:${shortEventId}`);
    if (!event) {
      await sendMessage(
        fmt.build(
          fmt.header('❓  Meeting Not Found'),
          '',
          `  No follow-up found for ID *${shortEventId}*.`,
          '  It may have already been dismissed or expired.',
          '',
          fmt.footer('Follow-up prompts expire after 1 hour.')
        )
      );
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

    // ─── Parse SUMMARY and ACTION ITEMS blocks ─────────────────────────────
    const rawText = content.text;
    const summaryMatch = rawText.match(/SUMMARY:\s*([\s\S]*?)(?=ACTION ITEMS:|$)/i);
    const actionMatch = rawText.match(/ACTION ITEMS:\s*([\s\S]*?)$/i);

    const summaryBody = summaryMatch ? summaryMatch[1].trim() : rawText.trim();
    const actionLines = actionMatch
      ? actionMatch[1]
          .trim()
          .split('\n')
          .map((l) => l.replace(/^[•\-\*]\s*/, '').trim())
          .filter(Boolean)
      : [];

    const startTime = new Date(event.start).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.user.timezone,
    });
    const endTime = new Date(event.end).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.user.timezone,
    });
    const dateStr = new Date(event.start).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: config.user.timezone,
    });

    const messageParts: string[] = [
      fmt.header('📋  Meeting Summary', event.title),
      fmt.footer(`${dateStr}  ·  ${startTime} – ${endTime}`),
      '',
      fmt.divider(),
      '*Overview*',
      `  ${summaryBody.replace(/\n/g, '\n  ')}`,
    ];

    if (actionLines.length > 0) {
      messageParts.push('');
      messageParts.push(fmt.divider());
      messageParts.push('*Action Items*');
      messageParts.push('');
      messageParts.push(fmt.numbered(actionLines));
    }

    messageParts.push('');
    messageParts.push(fmt.divider());
    messageParts.push(fmt.footer('Reply DONE to mark all action items as complete.'));

    await sendMessage(fmt.build(...messageParts));
    console.log(`[FollowUpAgent] Summary sent for ${event.title}`);
  }
}

export const followUpAgent = new FollowUpAgent();
