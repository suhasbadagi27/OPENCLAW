import { google, calendar_v3 } from 'googleapis';
import { config } from '../config';
import { ScoredEvent, MeetingPrioritySchema } from '../types';

const calendar = google.calendar('v3');

function getOAuth2Client() {
  const auth = new google.auth.OAuth2(
    config.google.calendarClientId,
    config.google.calendarClientSecret
  );
  auth.setCredentials({ refresh_token: config.google.calendarRefreshToken });
  return auth;
}

/** Fetch today's events from Google Calendar */
export async function getTodayEvents(): Promise<ScoredEvent[]> {
  const auth = getOAuth2Client();
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const response = await calendar.events.list({
    auth,
    calendarId: 'primary',
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const events = response.data.items ?? [];
  return events.map((e) => scoreEvent(e));
}

/** Fetch a single event by ID */
export async function getEventById(eventId: string): Promise<ScoredEvent | null> {
  try {
    const auth = getOAuth2Client();
    const response = await calendar.events.get({ auth, calendarId: 'primary', eventId });
    return scoreEvent(response.data);
  } catch {
    return null;
  }
}

/** Agent 3 — Schedule Optimizer: score events */
function scoreEvent(e: calendar_v3.Schema$Event): ScoredEvent {

  const start: string = e.start?.dateTime ?? e.start?.date ?? new Date().toISOString();
  const end: string = e.end?.dateTime ?? e.end?.date ?? new Date().toISOString();
  const location = e.location ?? null;
  const attendeeCount = e.attendees?.length ?? 1;
  const isRecurring = (e.recurrence?.length ?? 0) > 0;
  const isPhysical = !!location && !isVirtualLink(location);

  // Scoring algorithm (0–100)
  let score = 0;
  if (isPhysical) score += 30;           // Physical meetings are high-stakes
  if (attendeeCount >= 5) score += 25;   // Large meetings
  else if (attendeeCount >= 2) score += 10;
  if (!isRecurring) score += 20;         // One-off meetings are more important
  if (location?.toLowerCase().includes('client')) score += 15;
  if (attendeeCount === 1) score += 5;   // 1:1 with someone

  const priority = score >= 55
    ? 'CRITICAL'
    : score >= 30
    ? 'IMPORTANT'
    : 'OPTIONAL';

  const conferenceLink =
    (e.conferenceData?.entryPoints?.[0]?.uri) ??
    extractConferenceLink(e.location ?? '') ??
    null;

  return {
    id: String(e.id ?? ''),
    title: String(e.summary ?? 'Untitled Event'),
    start,
    end,
    location,
    is_physical: isPhysical,
    attendee_count: attendeeCount,
    priority: MeetingPrioritySchema.parse(priority),
    score,
    conference_link: conferenceLink,
  };
}

function isVirtualLink(str: string): boolean {
  return /meet\.google\.com|zoom\.us|teams\.microsoft|webex|whereby/i.test(str);
}

function extractConferenceLink(str: string): string | null {
  const urlMatch = str.match(/https?:\/\/[^\s]+/);
  return urlMatch ? urlMatch[0] : null;
}

export { scoreEvent };
