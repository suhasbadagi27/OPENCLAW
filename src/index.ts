import 'dotenv/config';
import express from 'express';
import { config } from './config';
import { calendarRouter, startCalendarWatch } from './triggers/calendar';
import { getTelegramBot } from './triggers/telegram';
import { startEmailListener, stopEmailListener } from './triggers/email';
import { startCronJobs } from './triggers/cron';

async function main(): Promise<void> {
  console.log('🦾 OpenClaw starting up...');

  const app = express();

  // ─── Middleware ─────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ─── Health Check ────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Webhook Routers (Calendar only) ─────────────────────────────────────────
  app.use(calendarRouter());

  // ─── Start Express ────────────────────────────────────────────────────────────
  const port = config.port;
  app.listen(port, () => {
    console.log(`🌐 Server listening on port ${port}`);
    console.log(`   Health:            http://localhost:${port}/health`);
    console.log(`   Calendar webhook:  ${config.webhookBaseUrl}/webhook/calendar`);
  });

  // ─── Telegram Long-polling ────────────────────────────────────────────────────
  try {
    getTelegramBot();
    console.log('[Startup] ✅ Telegram bot connected');
  } catch (err) {
    console.warn('[Startup] Telegram bot init failed:', err);
  }

  // ─── Google Calendar Push Notifications ──────────────────────────────────────
  try {
    await startCalendarWatch();
    console.log('[Startup] ✅ Google Calendar watch active');
  } catch (err) {
    console.warn('[Startup] Calendar watch init failed:', err);
  }

  // ─── Email IMAP Listener ──────────────────────────────────────────────────────
  try {
    await startEmailListener();
  } catch (err) {
    console.warn('[Startup] Email listener init failed:', err);
  }

  // ─── Cron Jobs ────────────────────────────────────────────────────────────────
  startCronJobs();

  console.log('✅ OpenClaw is running. Telegram is your interface.');

  // ─── Graceful Shutdown ─────────────────────────────────────────────────────────
  process.on('SIGTERM', async () => {
    console.log('\n[Shutdown] SIGTERM received — shutting down gracefully...');
    await stopEmailListener();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\n[Shutdown] SIGINT received — shutting down gracefully...');
    await stopEmailListener();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('❌ Fatal error during startup:', err);
  process.exit(1);
});
