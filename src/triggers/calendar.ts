import { google } from 'googleapis';
import { Router, Request, Response } from 'express';
import { config } from '../config';
import { orchestrator } from '../pipeline/orchestrator';
import { signalIngest } from '../agents/signalIngest';

const calendar = google.calendar('v3');

let watchChannelId: string | null = null;
let watchResourceId: string | null = null;

function getOAuth2Client() {
  const auth = new google.auth.OAuth2(
    config.google.calendarClientId,
    config.google.calendarClientSecret
  );
  auth.setCredentials({ refresh_token: config.google.calendarRefreshToken });
  return auth;
}

/** Register a push notification channel with Google Calendar */
export async function startCalendarWatch(): Promise<void> {
  const auth = getOAuth2Client();
  const channelId = `openclaw-${Date.now()}`;
  const webhookUrl = `${config.webhookBaseUrl}/webhook/calendar`;

  try {
    const response = await calendar.events.watch({
      auth,
      calendarId: 'primary',
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
      },
    });

    watchChannelId = response.data.id ?? null;
    watchResourceId = response.data.resourceId ?? null;

    const expiry = response.data.expiration;
    console.log(
      `[Calendar] Watch registered — channel: ${watchChannelId}, expires: ${new Date(Number(expiry)).toISOString()}`
    );

    // Re-register before expiry (Google allows 7 days max)
    const expiryMs = Number(expiry) - Date.now() - 60 * 60 * 1000; // 1hr before
    if (expiryMs > 0) {
      setTimeout(() => startCalendarWatch(), expiryMs);
    }
  } catch (err) {
    console.error('[Calendar] Failed to start watch:', err);
  }
}

/** Stop the watch channel */
export async function stopCalendarWatch(): Promise<void> {
  if (!watchChannelId || !watchResourceId) return;
  const auth = getOAuth2Client();
  try {
    await calendar.channels.stop({
      auth,
      requestBody: { id: watchChannelId, resourceId: watchResourceId },
    });
    console.log('[Calendar] Watch stopped');
  } catch (err) {
    console.warn('[Calendar] Failed to stop watch:', err);
  }
}

/** Express router for calendar push notifications */
export function calendarRouter(): Router {
  const router = Router();

  router.post('/webhook/calendar', async (req: Request, res: Response) => {
    // Acknowledge immediately
    res.status(200).send('OK');

    const channelId = req.headers['x-goog-channel-id'] as string;
    const resourceState = req.headers['x-goog-resource-state'] as string;

    if (resourceState === 'sync') {
      console.log('[Calendar] Sync notification — ignoring');
      return;
    }

    console.log(`[Calendar] Push notification received — state: ${resourceState}`);

    // Fetch the changed events and process them
    try {
      const auth = getOAuth2Client();
      const now = new Date();
      const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const response = await calendar.events.list({
        auth,
        calendarId: 'primary',
        timeMin: now.toISOString(),
        timeMax: in24h.toISOString(),
        updatedMin: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // updated in last 5 min
        singleEvents: true,
      });

      const events = response.data.items ?? [];
      for (const event of events) {
        const signal = signalIngest.fromCalendar(
          event.summary ?? 'Calendar Event',
          event.id ?? '',
          {
            start: event.start?.dateTime ?? event.start?.date,
            end: event.end?.dateTime ?? event.end?.date,
            location: event.location,
            status: event.status,
          }
        );
        await orchestrator.process(signal);
      }
    } catch (err) {
      console.error('[Calendar] Error processing push notification:', err);
    }
  });

  return router;
}
