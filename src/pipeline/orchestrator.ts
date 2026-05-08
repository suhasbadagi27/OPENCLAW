import { Signal } from '../types';
import { aiClassifier } from '../agents/aiClassifier';
import { getTodayEvents, getEventById } from '../agents/scheduleOptimizer';
import { travelAgent } from '../agents/travelAgent';
import { briefingEngine } from '../agents/briefingEngine';
import { autoResponder } from '../agents/autoResponder';
import { followUpAgent } from '../agents/followUpAgent';
import { learningAgent } from '../agents/learningAgent';
import { getApprovalState, clearApprovalState, memGet } from '../context/memory';
import { sendMessage } from '../messenger';
import { config } from '../config';
import { ApprovalState } from '../types';
import fmt from '../utils/fmt';

/** Main Pipeline Orchestrator
 *
 * Receives every normalized Signal and routes it through the appropriate agents.
 * User interacts via Telegram — all commands handled here.
 */
export class Orchestrator {
  async process(signal: Signal): Promise<void> {
    console.log(`[Orchestrator] Processing signal: ${signal.id} | ${signal.source}/${signal.type}`);

    try {
      // ─── Cron: Morning Briefing ───────────────────────────────────────────
      if (signal.type === 'cron_briefing') {
        await briefingEngine.handle();
        const events = await getTodayEvents();
        for (const event of events) {
          if (event.is_physical) {
            await travelAgent.handle(event);
          }
          followUpAgent.scheduleFollowUp(event);
        }
        return;
      }

      // ─── Calendar Event Push ──────────────────────────────────────────────
      if (signal.type === 'calendar_event') {
        const eventId = signal.metadata?.['event_id'] as string;
        if (eventId) {
          const event = await getEventById(eventId);
          if (event && event.is_physical) {
            await travelAgent.handle(event);
            followUpAgent.scheduleFollowUp(event);
          }
          if (event) {
            const startTime = new Date(event.start).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: config.user.timezone,
            });

            const priorityEmoji =
              event.priority === 'CRITICAL' ? '🔴' : event.priority === 'IMPORTANT' ? '🟡' : '🔵';

            await sendMessage(
              fmt.build(
                fmt.header('📅  Calendar Update'),
                '',
                `${priorityEmoji}  *${event.title}*`,
                fmt.field('Starts at', startTime),
                fmt.field('Priority', event.priority),
                event.location ? fmt.field('Location', event.location) : '',
                event.conference_link ? fmt.field('Link', event.conference_link) : '',
                '',
                fmt.footer('Reply TODAY to see your full schedule.')
              )
            );
          }
        }
        return;
      }

      // ─── Incoming User Message (Telegram) ────────────────────────────────
      if (signal.type === 'message') {
        const handled = await this.handleUserCommand(signal);
        if (handled) return;

        // Classify the message with Claude
        let classification;
        try {
          classification = await aiClassifier.handle(signal);
        } catch (err) {
          console.error('[Orchestrator] AI classifier failed:', err);
          await sendMessage(
            fmt.build(
              fmt.header('📨  Message Received'),
              '',
              fmt.quote(signal.raw_text.slice(0, 200)),
              '',
              fmt.divider(),
              '*Analysis*',
              "  ⚠️  Couldn't classify this message right now — AI error.",
              '  Try again in a moment, or reply *HELP* to see available commands.',
              fmt.divider(),
              fmt.footer('OpenClaw is still active and monitoring your inbox.')
            )
          );
          return;
        }

        // ─── Urgency & intent labels ──────────────────────────────────────
        const urgencyEmoji =
          classification.urgency === 'high' ? '🔴' : classification.urgency === 'medium' ? '🟡' : '🟢';

        const intentLabel: Record<string, string> = {
          meeting_invite: '📅  Meeting Invite',
          meeting_update: '📝  Meeting Update',
          meeting_cancel: '🚫  Meeting Cancellation',
          question: '❓  Question',
          approval: '✅  Approval Request',
          action_item: '🎯  Action Item',
          status_update: '📊  Status Update',
          general: '💬  General Message',
        };

        // ─── Route high-urgency or meeting invites to auto-responder ─────
        if (classification.has_meeting && classification.intent === 'meeting_invite') {
          await autoResponder.handle(signal, 'This is a meeting invite that may need a reply.');
          return;
        }

        if (classification.urgency === 'high' && classification.requires_response) {
          await autoResponder.handle(signal);
          return;
        }

        // ─── Standard classification card ─────────────────────────────────
        const nextStepLine = classification.requires_response
          ? '  ⚡ This message may require your attention.'
          : '  ✅ No action required at this time.';

        await sendMessage(
          fmt.build(
            fmt.header('📨  Message Received', `via ${signal.source}`),
            '',
            fmt.quote(signal.raw_text.slice(0, 200)),
            '',
            fmt.divider(),
            '*Analysis*',
            `  🏷  Intent:    ${intentLabel[classification.intent] ?? classification.intent}`,
            `  ${urgencyEmoji}  Urgency:   ${classification.urgency.charAt(0).toUpperCase() + classification.urgency.slice(1)}`,
            `  💬  Summary:   ${classification.summary}`,
            '',
            nextStepLine,
            fmt.divider(),
            fmt.footer('Reply HELP to see all commands.')
          )
        );
        return;
      }

      // ─── Email Signal ─────────────────────────────────────────────────────
      if (signal.type === 'email') {
        const classification = await aiClassifier.handle(signal);
        if (classification.intent === 'meeting_invite' || classification.requires_response) {
          await autoResponder.handle(signal, 'This arrived via email.');
        }
        return;
      }
    } catch (err) {
      console.error(`[Orchestrator] Error processing signal ${signal.id}:`, err);
      try {
        await sendMessage(
          fmt.build(
            fmt.header('⚠️  Something Went Wrong'),
            '',
            '  An unexpected error occurred while processing your request.',
            '  The issue has been logged and OpenClaw is still running.',
            '',
            fmt.divider(),
            fmt.footer('Check the server logs for details, or try again.')
          )
        );
      } catch { /* prevent infinite loop */ }
    }
  }

  /** Parse and handle command messages from the user */
  private async handleUserCommand(signal: Signal): Promise<boolean> {
    const text = signal.raw_text.trim().toUpperCase();
    const raw = signal.raw_text.trim();

    // ─── HELP ────────────────────────────────────────────────────────────────
    if (text === 'HELP') {
      await sendMessage(
        fmt.build(
          fmt.header('🤖  OpenClaw — Command Guide', 'Your intelligent personal assistant'),
          '',
          '*📅  Schedule & Travel*',
          fmt.command('TODAY', 'Re-run your morning briefing'),
          fmt.command('LEFT', 'Record your departure for the next physical meeting'),
          '',
          '*📊  Intelligence & Insights*',
          fmt.command('INSIGHTS', 'View your weekly punctuality report'),
          fmt.command('SUMMARY <id>', 'Generate an AI summary for a completed meeting'),
          '',
          '*✉️  Draft Approval*',
          fmt.command('SEND <id>', 'Approve and send the suggested draft reply'),
          fmt.command('EDIT <id> <text>', 'Replace the draft with your own reply text'),
          fmt.command('SKIP <id>', 'Discard the draft — no reply will be sent'),
          '',
          fmt.divider(),
          fmt.footer('Tip: Replace <id> with the 8-character code shown in each draft.'),
          fmt.footer('Commands are not case-sensitive. OpenClaw is always watching. 👁️')
        )
      );
      return true;
    }

    // ─── TODAY ───────────────────────────────────────────────────────────────
    if (text === 'TODAY') {
      try {
        await briefingEngine.handle();
      } catch (err) {
        console.error('[Orchestrator] TODAY failed:', err);
        await sendMessage(
          fmt.build(
            fmt.header('📅  Morning Briefing — Unavailable'),
            '',
            '  Google Calendar is not connected.',
            '  Add valid OAuth credentials to `.env` to see your schedule.',
            '',
            fmt.divider(),
            '*System Status*',
            fmt.status('Telegram interface', true),
            fmt.status('Claude AI (classification & drafts)', true),
            fmt.status('Redis memory (Upstash)', true),
            fmt.status('Email IMAP listener', true),
            fmt.status('Google Calendar', false),
            fmt.status('Google Maps (travel times)', false),
            fmt.divider(),
            fmt.footer('Add real Google OAuth credentials to .env and restart the server.')
          )
        );
      }
      return true;
    }

    // ─── LEFT ────────────────────────────────────────────────────────────────
    if (text === 'LEFT') {
      try {
        const events = await getTodayEvents();
        const nextPhysical = events.find((e) => e.is_physical && new Date(e.start) > new Date());
        if (nextPhysical) {
          await learningAgent.recordDeparture(nextPhysical);
          const meetingTime = new Date(nextPhysical.start).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: config.user.timezone,
          });
          await sendMessage(
            fmt.build(
              fmt.header('🚗  Departure Recorded'),
              '',
              `  You're heading to *${nextPhysical.title}*.`,
              fmt.field('Meeting time', meetingTime),
              fmt.field('Location', nextPhysical.location ?? 'Physical venue'),
              '',
              fmt.divider(),
              "  Safe travels! I'll track your punctuality for this meeting.",
              fmt.footer('Your on-time patterns are saved in INSIGHTS.')
            )
          );
        } else {
          await sendMessage(
            fmt.build(
              fmt.header('📅  No Upcoming Physical Meetings'),
              '',
              '  There are no physical meetings remaining in today\'s schedule.',
              '  Your next meeting may be virtual, or your calendar is clear.',
              '',
              fmt.footer('Reply TODAY to see your full schedule.')
            )
          );
        }
      } catch (err) {
        console.error('[Orchestrator] LEFT failed:', err);
        await sendMessage(
          fmt.build(
            fmt.header('📅  Departure Check — Unavailable'),
            '',
            '  Cannot read your schedule — Google Calendar is not connected.',
            '',
            fmt.footer('Add real Google OAuth credentials to .env to enable this feature.')
          )
        );
      }
      return true;
    }

    // ─── INSIGHTS ────────────────────────────────────────────────────────────
    if (text === 'INSIGHTS') {
      try {
        const insights = await learningAgent.getWeeklyInsights();
        await sendMessage(insights);
      } catch (err) {
        console.error('[Orchestrator] INSIGHTS failed:', err);
        await sendMessage(
          fmt.build(
            fmt.header('📊  Insights — Unavailable'),
            '',
            '  Could not load your pattern data.',
            '  This is usually a Redis connectivity issue.',
            '',
            fmt.footer('Check your Upstash credentials in .env and try again.')
          )
        );
      }
      return true;
    }

    // ─── SEND <id> ───────────────────────────────────────────────────────────
    const sendMatch = raw.match(/^SEND\s+([a-f0-9]{8})/i);
    if (sendMatch) {
      await this.handleApproval(sendMatch[1], 'send', null);
      return true;
    }

    // ─── EDIT <id> <custom text> ─────────────────────────────────────────────
    const editMatch = raw.match(/^EDIT\s+([a-f0-9]{8})\s+(.+)/is);
    if (editMatch) {
      await this.handleApproval(editMatch[1], 'edit', editMatch[2].trim());
      return true;
    }

    // ─── SKIP <id> ───────────────────────────────────────────────────────────
    const skipMatch = raw.match(/^SKIP\s+([a-f0-9]{8})/i);
    if (skipMatch) {
      await this.handleApproval(skipMatch[1], 'skip', null);
      return true;
    }

    // ─── SUMMARY <id> ────────────────────────────────────────────────────────
    const summaryMatch = raw.match(/^SUMMARY\s+([a-f0-9]{8})/i);
    if (summaryMatch) {
      await followUpAgent.generateSummary(summaryMatch[1]);
      return true;
    }

    return false;
  }

  private async handleApproval(
    shortId: string,
    action: 'send' | 'edit' | 'skip',
    customText: string | null
  ): Promise<void> {
    const fullId = await memGet<string>(`approval:short:${shortId}`);
    if (!fullId) {
      await sendMessage(
        fmt.build(
          fmt.header('❓  Draft Not Found'),
          '',
          `  No draft with ID *${shortId}* was found in memory.`,
          '  It may have already been sent, skipped, or expired.',
          '',
          fmt.footer('Drafts expire after 1 hour.')
        )
      );
      return;
    }

    const state = await getApprovalState<ApprovalState>(fullId);
    if (!state) {
      await sendMessage(
        fmt.build(
          fmt.header('❓  Draft Not Found'),
          '',
          `  Draft *${shortId}* has expired or was already processed.`,
          '',
          fmt.footer('Drafts expire after 1 hour.')
        )
      );
      return;
    }

    // ─── SKIP ────────────────────────────────────────────────────────────────
    if (action === 'skip') {
      await clearApprovalState(fullId);
      await clearApprovalState(`short:${shortId}`);
      await sendMessage(
        fmt.build(
          fmt.header('🗑️  Draft Discarded'),
          '',
          `  Draft *${shortId}* has been discarded.`,
          '  No reply was sent.',
          '',
          fmt.footer('This draft has been cleared from memory.')
        )
      );
      return;
    }

    // ─── SEND / EDIT ─────────────────────────────────────────────────────────
    const textToSend = action === 'edit' && customText ? customText : state.draft;
    const label = action === 'edit' ? 'Custom reply sent' : 'Draft sent';
    console.log(`[Orchestrator] Sending approved reply: ${textToSend.slice(0, 100)}`);

    await sendMessage(
      fmt.build(
        fmt.header('✅  Reply Sent'),
        '',
        `  ${label} for draft *${shortId}*.`,
        '',
        fmt.divider(),
        '*Sent Text*',
        fmt.quote(textToSend),
        fmt.divider(),
        fmt.footer('This draft has been cleared from memory.')
      )
    );

    await clearApprovalState(fullId);
    await clearApprovalState(`short:${shortId}`);
  }
}

export const orchestrator = new Orchestrator();
