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
            await sendMessage(
              `📅 *Calendar Update*\n${event.title} — ${startTime}\nPriority: ${event.priority}`
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
            '🤔 *Message received*\n\n' +
            `_"${signal.raw_text.slice(0, 150)}"_\n\n` +
            'I couldn\'t classify this right now (AI error). Try again in a moment.'
          );
          return;
        }

        if (classification.has_meeting && classification.intent === 'meeting_invite') {
          await autoResponder.handle(signal, 'This is a meeting invite that may need a reply.');
          return;
        }

        if (classification.urgency === 'high' && classification.requires_response) {
          await autoResponder.handle(signal);
          return;
        }

        await sendMessage(
          `📨 *Message Received*\n\n` +
          `_"${signal.raw_text.slice(0, 200)}"_\n\n` +
          `🏷 Intent: ${classification.intent}\n` +
          `⚡ Urgency: ${classification.urgency}\n` +
          `📝 ${classification.summary}`
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
          `⚠️ *Something went wrong*\n\n` +
          `An unexpected error occurred while processing your request.\n` +
          `_Check the server logs for details._`
        );
      } catch { /* prevent infinite loop */ }
    }
  }

  /** Parse and handle command messages from the user */
  private async handleUserCommand(signal: Signal): Promise<boolean> {
    const text = signal.raw_text.trim().toUpperCase();
    const raw = signal.raw_text.trim();

    // HELP
    if (text === 'HELP') {
      const helpMessage = [
        `🤖 *OpenClaw — Command Reference*`,
        ``,
        `━━━━━━━━━━━━━━━━━━━━`,
        `📅 *Schedule*`,
        `  *TODAY* — Today's briefing & travel times`,
        `  *LEFT* — Record departure for next meeting`,
        ``,
        `📊 *Intelligence*`,
        `  *INSIGHTS* — Weekly punctuality report`,
        `  *SUMMARY <id>* — Get meeting summary`,
        ``,
        `✉️ *Draft Approval*`,
        `  *SEND <id>* — Approve & send draft reply`,
        `  *EDIT <id> <text>* — Send custom reply`,
        `  *SKIP <id>* — Discard draft`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `_OpenClaw is always watching. 👁️_`,
      ].join('\n');
      await sendMessage(helpMessage);
      return true;
    }

    // TODAY — re-send morning briefing
    if (text === 'TODAY') {
      try {
        await briefingEngine.handle();
      } catch (err) {
        console.error('[Orchestrator] TODAY failed:', err);
        await sendMessage(
          '⚠️ *Calendar Not Connected*\n\n' +
          'Google Calendar credentials are placeholder values in `.env`.\n\n' +
          '*What\'s working right now:*\n' +
          '✅ Telegram interface\n' +
          '✅ Claude AI classification\n' +
          '✅ Redis memory (Upstash)\n' +
          '✅ Email IMAP listener\n\n' +
          '❌ Google Calendar — add real OAuth credentials to `.env` to enable schedule features.'
        );
      }
      return true;
    }

    // LEFT — user departed for a meeting
    if (text === 'LEFT') {
      try {
        const events = await getTodayEvents();
        const nextPhysical = events.find((e) => e.is_physical && new Date(e.start) > new Date());
        if (nextPhysical) {
          await learningAgent.recordDeparture(nextPhysical);
          await sendMessage(
            `🚗 *Departure Recorded*\n\n` +
            `Heading to *${nextPhysical.title}*\n` +
            `Scheduled: ${new Date(nextPhysical.start).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: config.user.timezone })}\n\n` +
            `Safe travels! I'll track your punctuality for this meeting. 📊`
          );
        } else {
          await sendMessage(
            '📅 *No Physical Meetings Found*\n\n' +
            'There are no upcoming physical meetings in today\'s schedule.'
          );
        }
      } catch (err) {
        console.error('[Orchestrator] LEFT failed:', err);
        await sendMessage(
          '⚠️ *Calendar Not Connected*\n\n' +
          'Cannot check your schedule without Google Calendar credentials.\n' +
          'Add real OAuth credentials to `.env` to enable this feature.'
        );
      }
      return true;
    }

    // INSIGHTS — weekly pattern report
    if (text === 'INSIGHTS') {
      try {
        const insights = await learningAgent.getWeeklyInsights();
        await sendMessage(insights);
      } catch (err) {
        console.error('[Orchestrator] INSIGHTS failed:', err);
        await sendMessage('⚠️ *Could not load insights.*\n\nRedis connection issue — check your Upstash credentials.');
      }
      return true;
    }

    // SEND <id> — approve a draft reply
    const sendMatch = raw.match(/^SEND\s+([a-f0-9]{8})/i);
    if (sendMatch) {
      await this.handleApproval(sendMatch[1], 'send', null);
      return true;
    }

    // EDIT <id> <custom text>
    const editMatch = raw.match(/^EDIT\s+([a-f0-9]{8})\s+(.+)/is);
    if (editMatch) {
      await this.handleApproval(editMatch[1], 'edit', editMatch[2].trim());
      return true;
    }

    // SKIP <id> — discard draft
    const skipMatch = raw.match(/^SKIP\s+([a-f0-9]{8})/i);
    if (skipMatch) {
      await this.handleApproval(skipMatch[1], 'skip', null);
      return true;
    }

    // SUMMARY <id> — request meeting summary
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
      await sendMessage(`❓ Approval *${shortId}* not found or expired.`);
      return;
    }

    const state = await getApprovalState<ApprovalState>(fullId);
    if (!state) {
      await sendMessage(`❓ Approval *${shortId}* not found or expired.`);
      return;
    }

    if (action === 'skip') {
      await clearApprovalState(fullId);
      await clearApprovalState(`short:${shortId}`);
      await sendMessage(`❌ Draft discarded.`);
      return;
    }

    const textToSend = action === 'edit' && customText ? customText : state.draft;
    console.log(`[Orchestrator] Sending approved reply: ${textToSend.slice(0, 100)}`);
    await sendMessage(`✅ Reply sent:\n\n_"${textToSend}"_`);

    await clearApprovalState(fullId);
    await clearApprovalState(`short:${shortId}`);
  }
}

export const orchestrator = new Orchestrator();
