import { v4 as uuidv4 } from 'uuid';
import { Signal, SignalSchema, SignalSource, SignalType } from '../types';

/** Agent 1 — Signal Ingest
 *
 * Normalizes all raw trigger inputs into a unified Signal schema.
 * Every downstream agent receives a validated Signal object.
 */
export class SignalIngestAgent {
  readonly name = 'SignalIngest';

  handle(raw: {
    source: SignalSource;
    type: SignalType;
    raw_text: string;
    metadata?: Record<string, unknown>;
    sender_id?: string;
  }): Signal {
    const signal: Signal = SignalSchema.parse({
      id: uuidv4(),
      source: raw.source,
      type: raw.type,
      raw_text: raw.raw_text,
      timestamp: new Date().toISOString(),
      metadata: raw.metadata ?? {},
      sender_id: raw.sender_id,
    });

    console.log(`[SignalIngest] Normalized signal: ${signal.id} | ${signal.source}/${signal.type}`);
    return signal;
  }

  /** Helper: create a signal from WhatsApp */
  fromWhatsApp(body: string, from: string, metadata?: Record<string, unknown>): Signal {
    return this.handle({
      source: 'whatsapp',
      type: 'message',
      raw_text: body,
      sender_id: from,
      metadata,
    });
  }

  /** Helper: create a signal from Telegram */
  fromTelegram(text: string, chatId: number, metadata?: Record<string, unknown>): Signal {
    return this.handle({
      source: 'telegram',
      type: 'message',
      raw_text: text,
      sender_id: String(chatId),
      metadata,
    });
  }

  /** Helper: create a signal from calendar event push */
  fromCalendar(eventSummary: string, eventId: string, metadata?: Record<string, unknown>): Signal {
    return this.handle({
      source: 'calendar',
      type: 'calendar_event',
      raw_text: eventSummary,
      metadata: { event_id: eventId, ...metadata },
    });
  }

  /** Helper: create a signal from email */
  fromEmail(subject: string, body: string, metadata?: Record<string, unknown>): Signal {
    return this.handle({
      source: 'email',
      type: 'email',
      raw_text: `Subject: ${subject}\n\n${body}`,
      metadata,
    });
  }

  /** Helper: create a signal from cron (morning briefing) */
  fromCron(): Signal {
    return this.handle({
      source: 'cron',
      type: 'cron_briefing',
      raw_text: 'Morning briefing triggered by scheduler',
    });
  }
}

export const signalIngest = new SignalIngestAgent();
