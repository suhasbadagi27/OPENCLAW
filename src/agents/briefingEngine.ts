import { config } from '../config';
import { ScoredEvent } from '../types';
import { getTodayEvents } from './scheduleOptimizer';
import { getDrivingDirections } from '../context/maps';
import { getWeatherForLocation, weatherEmoji, WeatherCondition } from '../context/weather';
import { sendMessage } from '../messenger';

/** Agent 5 — Briefing Engine
 *
 * Fires at 7 AM daily. Composes and sends the full day summary via Telegram.
 */
export class BriefingEngineAgent {
  readonly name = 'BriefingEngine';

  async handle(): Promise<void> {
    console.log('[BriefingEngine] Composing morning briefing...');

    let events: import('../types').ScoredEvent[] = [];
    try {
      events = await getTodayEvents();
    } catch (err) {
      console.error('[BriefingEngine] Failed to fetch calendar events:', err);
      await sendMessage(
        '☀️ *Good morning!*\n\n' +
        '⚠️ *Calendar Unavailable*\n' +
        'Could not fetch your schedule — Google Calendar credentials are not configured.\n\n' +
        '*System Status:*\n' +
        '✅ Telegram — connected\n' +
        '✅ Claude AI — ready\n' +
        '✅ Redis — connected\n' +
        '✅ Email IMAP — watching inbox\n' +
        '❌ Google Calendar — missing credentials\n\n' +
        '_Add real Google OAuth credentials to `.env` to see your schedule._'
      );
      return;
    }

    if (events.length === 0) {
      await sendMessage(
        '☀️ *Good morning!*\n\nNo meetings scheduled today — enjoy the free day! 🎉'
      );
      return;
    }

    let weather: { condition: WeatherCondition; description: string } = {
      condition: 'clear',
      description: 'clear skies',
    };
    try {
      weather = await getWeatherForLocation(config.user.homeAddress);
    } catch (err) {
      console.warn('[BriefingEngine] Weather fetch failed, proceeding without weather');
    }

    const lines: string[] = [];
    lines.push("☀️ *Good morning! Here's your day:*\n");

    for (const event of events) {
      const startTime = new Date(event.start).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: config.user.timezone,
      });

      const priorityEmoji =
        event.priority === 'CRITICAL' ? '🔴' : event.priority === 'IMPORTANT' ? '🟡' : '🔵';

      if (event.is_physical && event.location) {
        let travelLine = '';
        try {
          const directions = await getDrivingDirections(config.user.homeAddress, event.location);
          const leaveBy = new Date(
            new Date(event.start).getTime() -
              directions.duration_in_traffic_minutes * 60 * 1000 -
              10 * 60 * 1000
          );
          const leaveByStr = leaveBy.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: config.user.timezone,
          });
          travelLine = ` → 🚗 Leave by ${leaveByStr} (${directions.duration_in_traffic_minutes} min)`;
        } catch {
          travelLine = ` → 🚗 Physical meeting`;
        }
        lines.push(
          `${priorityEmoji} *${startTime}* — ${event.title} @ ${event.location}${travelLine}`
        );
      } else if (event.conference_link) {
        lines.push(`${priorityEmoji} *${startTime}* — ${event.title} (virtual 🖥️)`);
      } else {
        lines.push(`${priorityEmoji} *${startTime}* — ${event.title}`);
      }
    }

    lines.push('');

    if (weather.condition === 'rain') {
      lines.push(`${weatherEmoji('rain')} Heavy rain expected — adjust your travel window.`);
    } else if (weather.condition === 'storm') {
      lines.push(`${weatherEmoji('storm')} Storm warning — consider rescheduling physical meetings.`);
    } else if (weather.condition === 'fog') {
      lines.push(`${weatherEmoji('fog')} Foggy conditions — leave earlier for physical meetings.`);
    }

    const physicalCount = events.filter((e) => e.is_physical).length;
    const criticalCount = events.filter((e) => e.priority === 'CRITICAL').length;
    lines.push(
      `\n📊 ${events.length} meeting${events.length !== 1 ? 's' : ''} today · ${physicalCount} physical · ${criticalCount} critical`
    );
    lines.push(`\nReply *TODAY* anytime to see this again.`);

    await sendMessage(lines.join('\n'));
    console.log('[BriefingEngine] Morning briefing sent successfully');
  }
}

export const briefingEngine = new BriefingEngineAgent();
