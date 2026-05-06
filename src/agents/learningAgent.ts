import { config } from '../config';
import { ScoredEvent } from '../types';
import {
  recordMeetingOutcome,
  getLatePatternsForType,
  memSet,
  memGet,
  memListGet,
} from '../context/memory';

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

    const physical = allMeetings.filter((m) => m.meeting_type === 'physical');
    const virtualMeetings = allMeetings.filter((m) => m.meeting_type === 'virtual');
    const onTimePhysical = physical.filter((m) => m.was_on_time === true).length;
    const latePhysical = physical.filter((m) => m.was_on_time === false).length;

    return [
      `📊 *Weekly Insights*`,
      ``,
      `🏢 Physical meetings: ${physical.length} total`,
      `  ✅ On time: ${onTimePhysical}`,
      `  ⏰ Late: ${latePhysical}`,
      `💻 Virtual meetings: ${virtualMeetings.length} total`,
      ``,
      latePhysical > onTimePhysical
        ? `⚠️ You tend to be late for physical meetings. I've added extra buffer to your departure alerts.`
        : `✅ Great punctuality this week!`,
    ].join('\n');
  }
}

export const learningAgent = new LearningAgent();
