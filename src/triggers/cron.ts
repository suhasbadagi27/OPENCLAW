import cron from 'node-cron';
import { config } from '../config';
import { briefingEngine } from '../agents/briefingEngine';
import { learningAgent } from '../agents/learningAgent';
import { sendMessage } from '../messenger';

/** All scheduled cron jobs for OpenClaw */
export function startCronJobs(): void {
  const tz = config.user.timezone;

  // ─── Morning Briefing: 7:00 AM daily ─────────────────────────────────────
  cron.schedule(
    '0 7 * * *',
    async () => {
      console.log('[Cron] Morning briefing triggered');
      try {
        await briefingEngine.handle();
      } catch (err) {
        console.error('[Cron] Briefing error:', err);
      }
    },
    { timezone: tz }
  );

  // ─── Evening Digest: 9:00 PM daily ───────────────────────────────────────
  cron.schedule(
    '0 21 * * *',
    async () => {
      console.log('[Cron] Evening digest triggered');
      try {
        const insights = await learningAgent.getWeeklyInsights();
        await sendMessage(`🌙 *End of Day*\n\n${insights}\n\n📅 Tomorrow's briefing at 7 AM.`);
      } catch (err) {
        console.error('[Cron] Evening digest error:', err);
      }
    },
    { timezone: tz }
  );

  // ─── Weekly Insights: Sunday 8:00 PM ─────────────────────────────────────
  cron.schedule(
    '0 20 * * 0',
    async () => {
      console.log('[Cron] Weekly insights triggered');
      try {
        const insights = await learningAgent.getWeeklyInsights();
        await sendMessage(insights);
      } catch (err) {
        console.error('[Cron] Weekly insights error:', err);
      }
    },
    { timezone: tz }
  );

  console.log('[Cron] All scheduled jobs started');
}
