import { config } from '../config';
import { ScoredEvent } from '../types';
import {
  recordMeetingOutcome,
  getLatePatternsForType,
  memSet,
  memGet,
  memListGet,
} from '../context/memory';
import fmt from '../utils/fmt';

export interface DepartureRecord {
  event_id: string;
  departed_at: string; // ISO
}

/** Agent 8 — Learning Agent
 *
 * Tracks departure times, lateness patterns, and adapts notification behavior.
 * Stores all data in Upstash Redis.
 */
export class LearningAgent {
  readonly name = 'LearningAgent';

  /** Record that the user has departed for a meeting */
  async recordDeparture(event: ScoredEvent): Promise<void> {
    const record: DepartureRecord = {
      event_id: event.id,
      departed_at: new Date().toISOString(),
    };
    await memSet(`departure:${event.id}`, record, 86400 * 7); // keep for 7 days
    console.log(`[LearningAgent] Recorded departure for ${event.title}`);
  }

  /** After a meeting, evaluate if user was on time */
  async evaluateOutcome(event: ScoredEvent): Promise<void> {
    const departure = await memGet<DepartureRecord>(`departure:${event.id}`);
    const scheduledStart = new Date(event.start);

    let wasOnTime: boolean | null = null;

    if (departure) {
      const departedAt = new Date(departure.departed_at);
      const travelMinutes = 30; // rough estimate — could pull from TravelInfo stored in Redis
      const estimatedArrival = new Date(departedAt.getTime() + travelMinutes * 60 * 1000);
      wasOnTime = estimatedArrival <= scheduledStart;
    }

    const meetingType = event.is_physical ? 'physical' : 'virtual';

    await recordMeetingOutcome({
      meeting_id: event.id,
      title: event.title,
      scheduled_start: event.start,
      actual_depart: departure?.departed_at ?? null,
      was_on_time: wasOnTime,
      meeting_type: meetingType,
    });

    if (wasOnTime === false) {
      console.log(`[LearningAgent] User was late to ${event.title} — updating patterns`);
    }

    // Check if habits warrant sending digest advice
    const patterns = await getLatePatternsForType(meetingType);
    if (patterns.habitual_late) {
      console.log(
        `[LearningAgent] Habitual lateness detected for ${meetingType} meetings — travel buffer increased`
      );
    }
  }

  /** Generate a weekly pattern report */
  async getWeeklyInsights(): Promise<string> {
    const allMeetings = await memListGet<{
      title: string;
      was_on_time: boolean | null;
      meeting_type: string;
    }>('patterns:meetings:all', 50);

    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const weekLabel = weekStart.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: config.user.timezone,
    });
    const weekEnd = now.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: config.user.timezone,
    });

    const physical = allMeetings.filter((m) => m.meeting_type === 'physical');
    const virtualMeetings = allMeetings.filter((m) => m.meeting_type === 'virtual');
    const onTimePhysical = physical.filter((m) => m.was_on_time === true).length;
    const latePhysical = physical.filter((m) => m.was_on_time === false).length;
    const untrackedPhysical = physical.filter((m) => m.was_on_time === null).length;

    const punctualityRate =
      physical.length > 0 ? Math.round((onTimePhysical / physical.length) * 100) : null;

    const rateBar =
      punctualityRate !== null
        ? this.buildProgressBar(punctualityRate)
        : '  No data yet';

    const isHabitual = latePhysical > onTimePhysical && physical.length >= 3;

    // ─── Analysis block ───────────────────────────────────────────────────
    const analysisLines: string[] = [];
    if (physical.length === 0 && virtualMeetings.length === 0) {
      analysisLines.push('  No meeting data recorded yet.');
      analysisLines.push('  Reply LEFT when you leave for a physical meeting to start tracking.');
    } else if (isHabitual) {
      analysisLines.push('  ⚠️  You tend to be late for physical meetings.');
      analysisLines.push('  I\'ve added a 15-min extra buffer to your departure alerts.');
    } else if (punctualityRate !== null && punctualityRate >= 80) {
      analysisLines.push('  ✅  Excellent punctuality this week — keep it up!');
    } else if (punctualityRate !== null && punctualityRate >= 50) {
      analysisLines.push('  🟡  Decent punctuality. A bit more buffer time could help.');
    } else if (punctualityRate !== null) {
      analysisLines.push('  ⚠️  Punctuality needs improvement.');
      analysisLines.push('  Consider leaving earlier — I\'ll automatically extend your travel buffer.');
    }

    return fmt.build(
      fmt.header('📊  Weekly Intelligence Report', `${weekLabel} – ${weekEnd}`),
      '',
      '*🏢  Physical Meetings*',
      fmt.field('Total', String(physical.length)),
      fmt.field('On time', String(onTimePhysical)),
      fmt.field('Late', String(latePhysical)),
      untrackedPhysical > 0 ? fmt.field('Untracked', String(untrackedPhysical)) : '',
      punctualityRate !== null
        ? `  Punctuality:  ${punctualityRate}%  ${rateBar}`
        : '  Punctuality:  No data yet',
      '',
      '*💻  Virtual Meetings*',
      fmt.field('Total', String(virtualMeetings.length)),
      '  _(Punctuality tracking not applicable for virtual meetings)_',
      '',
      fmt.divider(),
      '*Analysis*',
      '',
      ...analysisLines,
      '',
      fmt.divider(),
      fmt.footer(
        `Data from the last 14 days · ${allMeetings.length} meeting${allMeetings.length !== 1 ? 's' : ''} tracked.`
      )
    );
  }

  /** Build a simple ASCII progress bar for punctuality rate */
  private buildProgressBar(percent: number): string {
    const filled = Math.round(percent / 10);
    const empty = 10 - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }
}

export const learningAgent = new LearningAgent();
