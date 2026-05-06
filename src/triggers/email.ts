import { ImapFlow } from 'imapflow';
import { config } from '../config';
import { orchestrator } from '../pipeline/orchestrator';
import { signalIngest } from '../agents/signalIngest';

const MEETING_KEYWORDS = [
  'meeting', 'invite', 'calendar', 'event', 'schedule', 'call',
  'standup', 'sync', 'conference', 'webinar', 'zoom', 'google meet', 'teams',
];

function isMeetingRelated(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return MEETING_KEYWORDS.some((kw) => text.includes(kw));
}

let imapClient: ImapFlow | null = null;

/** Start IMAP IDLE listener for Gmail */
export async function startEmailListener(): Promise<void> {
  // Skip if Gmail OAuth creds not provided
  if (!process.env.IMAP_HOST && !config.google.gmailRefreshToken) {
    console.log('[Email] No IMAP/Gmail config — skipping email listener');
    return;
  }

  try {
    imapClient = new ImapFlow({
      host: process.env.IMAP_HOST ?? 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: {
        user: process.env.IMAP_USER ?? '',
        pass: process.env.IMAP_PASSWORD ?? '',
      },
      logger: false,
    });

    await imapClient.connect();
    const lock = await imapClient.getMailboxLock('INBOX');

    try {
      console.log('[Email] IMAP IDLE started — watching INBOX');

      // Process any new messages
      imapClient.on('exists', async (data) => {
        console.log(`[Email] New message detected — count: ${(data as { count: number }).count}`);
        await processLatestEmail();
      });

      // Keep IDLE alive
      await imapClient.idle();
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[Email] IMAP connection error:', err);
  }
}

async function processLatestEmail(): Promise<void> {
  if (!imapClient) return;

  try {
    const lock = await imapClient.getMailboxLock('INBOX');
    try {
      // Fetch the latest unseen message
      for await (const msg of imapClient.fetch('1:*', { envelope: true, bodyStructure: true })) {
        if (!msg.envelope) continue;
        const subject = msg.envelope.subject ?? '';
        const from = msg.envelope.from?.[0]?.address ?? 'unknown';

        if (isMeetingRelated(subject, '')) {
          const signal = signalIngest.fromEmail(subject, `From: ${from}\nSubject: ${subject}`, {
            from,
            uid: msg.uid,
          });
          await orchestrator.process(signal);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error('[Email] Error processing email:', err);
  }
}

export async function stopEmailListener(): Promise<void> {
  if (imapClient) {
    await imapClient.logout();
    imapClient = null;
    console.log('[Email] IMAP listener stopped');
  }
}
