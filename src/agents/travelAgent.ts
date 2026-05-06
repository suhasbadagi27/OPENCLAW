import { config } from '../config';
import { ScoredEvent } from '../types';
import { getDrivingDirections, calculateDepartureTime } from '../context/maps';
import { getWeatherForLocation, weatherEmoji } from '../context/weather';
import { getLatePatternsForType } from '../context/memory';
import { sendMessage } from '../messenger';

/** Agent 4 — Travel Agent
 *
 * Calculates real-time departure times for physical meetings.
 * Sends a Telegram message 30 minutes before calculated departure.
 */
export class TravelAgentAgent {
  readonly name = 'TravelAgent';

  async handle(event: ScoredEvent, origin?: string): Promise<import('../types').TravelInfo | null> {
    if (!event.is_physical || !event.location) {
      console.log(`[TravelAgent] Skipping virtual event: ${event.title}`);
      return null;
    }

    const userOrigin = origin ?? config.user.homeAddress;
    const meetingStart = new Date(event.start);

    // Check if this meeting type has a habitual lateness pattern
    const latePatterns = await getLatePatternsForType('physical');
    const lateBuffer = latePatterns.habitual_late ? 15 : 10;

    console.log(`[TravelAgent] Calculating route to ${event.location}...`);

    const [directions, weather] = await Promise.all([
      getDrivingDirections(userOrigin, event.location, new Date()),
      getWeatherForLocation(event.location),
    ]);

    const departBy = calculateDepartureTime(
      meetingStart,
      directions.duration_in_traffic_minutes,
      lateBuffer
    );

    const travelInfo: import('../types').TravelInfo = {
      meeting_id: event.id,
      depart_by: departBy.toISOString(),
      route_summary: directions.route_summary,
      duration_minutes: directions.duration_in_traffic_minutes,
      traffic_status: directions.traffic_status,
      weather_flag: weather.condition,
      weather_description: weather.description,
    };

    const alertTime = new Date(departBy);
    alertTime.setMinutes(alertTime.getMinutes() - 30);
    const msUntilAlert = alertTime.getTime() - Date.now();

    if (msUntilAlert > 0) {
      console.log(
        `[TravelAgent] Alert scheduled in ${Math.round(msUntilAlert / 60000)} minutes for ${event.title}`
      );
      setTimeout(() => this.sendDepartureAlert(event, travelInfo), msUntilAlert);
    } else {
      await this.sendDepartureAlert(event, travelInfo);
    }

    return travelInfo;
  }

  private async sendDepartureAlert(event: ScoredEvent, info: import('../types').TravelInfo): Promise<void> {
    const departTime = new Date(info.depart_by).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.user.timezone,
    });
    const meetingTime = new Date(event.start).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: config.user.timezone,
    });

    const trafficEmoji =
      info.traffic_status === 'heavy' ? '🚨' : info.traffic_status === 'moderate' ? '🟡' : '🟢';
    const weatherEm = weatherEmoji(info.weather_flag);

    const message = [
      `🚗 *Departure Alert — ${event.title}*`,
      ``,
      `Your meeting at *${event.location}* starts at *${meetingTime}*.`,
      ``,
      `📍 Route: ${info.route_summary}`,
      `⏱ Travel time: ${info.duration_minutes} min`,
      `${trafficEmoji} Traffic: ${info.traffic_status}`,
      `${weatherEm} Weather: ${info.weather_description}`,
      ``,
      `➡️ *Leave by ${departTime}*`,
      ``,
      `Reply *LEFT* when you depart, or *SNOOZE* for a 10-min reminder.`,
    ].join('\n');

    await sendMessage(message);
    console.log(`[TravelAgent] Departure alert sent for ${event.title}`);

    setTimeout(async () => {
      await sendMessage(
        `⚠️ Reminder: You need to leave for *${event.title}* at *${event.location}*. Leave by *${departTime}*!`
      );
    }, 15 * 60 * 1000);
  }
}

export const travelAgent = new TravelAgentAgent();
