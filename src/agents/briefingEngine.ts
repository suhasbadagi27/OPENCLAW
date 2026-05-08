import { config } from '../config';
import { ScoredEvent } from '../types';
import { getTodayEvents } from './scheduleOptimizer';
import { getDrivingDirections } from '../context/maps';
import { getWeatherForLocation, weatherEmoji, WeatherCondition } from '../context/weather';
import { sendMessage } from '../messenger';
import fmt from '../utils/fmt';

/** Agent 5 — Briefing Engine
 *
 * Fires at 7 AM daily. Composes and sends the full day summary via Telegram.
 */
export class BriefingEngineAgent {
  readonly name = 'BriefingEngine';

  async handle(): Promise<void> {
    console.log('[BriefingEngine] Composing morning briefing...');

    // ─── Date & Greeting ───────────────────────────────────────────────────
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: config.user.timezone,
    });

    const hour = now.toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: config.user.timezone });
    const greeting =
      Number(hour) < 12 ? 'Good Morning' : Number(hour) < 17 ? 'Good Afternoon' : 'Good Evening';

    // ─── Fetch Calendar Events ─────────────────────────────────────────────
    let events: ScoredEvent[] = [];
    try {
      events = await getTodayEvents();
    } catch (err) {
      console.error('[BriefingEngine] Failed to fetch calendar events:', err);
      await sendMessage(
        fmt.build(
          fmt.header(`☀️  ${greeting}!`, dateStr),
          '',
          '*Daily Briefing — Calendar Unavailable*',
          '',
          '  Could not fetch your schedule.',
          '  Google Calendar credentials are not configured yet.',
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
          fmt.footer('Add real Google OAuth credentials to .env to enable schedule features.')
        )
      );
      return;
    }

    // ─── No Events ─────────────────────────────────────────────────────────
    if (events.length === 0) {
      await sendMessage(
        fmt.build(
          fmt.header(`☀️  ${greeting}!`, dateStr),
          '',
          '  Your calendar is clear today — no meetings scheduled.',
          '  Enjoy the focus time! 🎉',
          '',
          fmt.footer('Reply TODAY anytime to see this again.')
        )
      );
      return;
    }

    // ─── Fetch Weather ─────────────────────────────────────────────────────
    let weather: { condition: WeatherCondition; description: string } = {
      condition: 'clear',
      description: 'clear skies',
    };
    try {
      weather = await getWeatherForLocation(config.user.homeAddress);
    } catch {
      console.warn('[BriefingEngine] Weather fetch failed, proceeding without weather data');
    }

    // ─── Build Message ─────────────────────────────────────────────────────
    const physicalCount = events.filter((e) => e.is_physical).length;
    const criticalCount = events.filter((e) => e.priority === 'CRITICAL').length;
    const importantCount = events.filter((e) => e.priority === 'IMPORTANT').length;

    const lines: string[] = [];

    // Header
    lines.push(fmt.header(`☀️  ${greeting}!`, dateStr));
    lines.push('');

    // Weather line
    const wEmoji = weatherEmoji(weather.condition);
    lines.push(`${wEmoji}  *Weather:* ${weather.description}`);
    lines.push(fmt.divider());
    lines.push('');

    // Schedule heading
    lines.push(
      `*📅  Today\'s Schedule*  _(${events.length} meeting${events.length !== 1 ? 's' : ''} · ${physicalCount} physical · ${criticalCount} critical)_`
    );
    lines.push('');

    // Event entries
    for (const event of events) {
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

      const priorityEmoji =
        event.priority === 'CRITICAL' ? '🔴' : event.priority === 'IMPORTANT' ? '🟡' : '🔵';
      const priorityTag = `[${event.priority}]`;

      // Event title row
      lines.push(`${priorityEmoji}  *${startTime} – ${endTime}*  —  ${event.title}  _${priorityTag}_`);

      // Physical meeting with travel info
      if (event.is_physical && event.location) {
        lines.push(`     📍 ${event.location}`);
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
          const trafficEmoji =
            directions.traffic_status === 'heavy'
              ? '🚨'
              : directions.traffic_status === 'moderate'
              ? '🟡'
              : '🟢';
          lines.push(
            `     🚗 Leave by *${leaveByStr}*  (${directions.duration_in_traffic_minutes} min · ${trafficEmoji} ${directions.traffic_status} traffic)`
          );
        } catch {
          lines.push('     🚗 Physical meeting — travel time unavailable');
        }
      } else if (event.conference_link) {
        lines.push('     🖥️  Virtual meeting (link in calendar invite)');
      } else {
        lines.push('     🖥️  Virtual / No location');
      }

      lines.push('');
    }

    // Weather advisory
    lines.push(fmt.divider());
    if (weather.condition === 'rain') {
      lines.push(`${weatherEmoji('rain')}  *Weather advisory:* Heavy rain expected — allow extra travel time.`);
    } else if (weather.condition === 'storm') {
      lines.push(`${weatherEmoji('storm')}  *Weather advisory:* Storm warning — consider rescheduling physical meetings.`);
    } else if (weather.condition === 'fog') {
      lines.push(`${weatherEmoji('fog')}  *Weather advisory:* Foggy conditions — leave 10–15 minutes earlier.`);
    } else {
      lines.push(`${weatherEmoji('clear')}  Conditions look good for travel today.`);
    }

    // Summary stats
    lines.push('');
    lines.push(
      `📊  *${events.length}* meetings  ·  *${physicalCount}* physical  ·  *${criticalCount}* critical  ·  *${importantCount}* important`
    );
    lines.push('');
    lines.push(fmt.divider());
    lines.push(fmt.footer('Reply TODAY anytime to see this again · HELP for all commands.'));

    await sendMessage(lines.join('\n'));
    console.log('[BriefingEngine] Morning briefing sent successfully');
  }
}

export const briefingEngine = new BriefingEngineAgent();
