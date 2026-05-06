import { z } from 'zod';

// ─── Core Signal Schema ────────────────────────────────────────────────────────

export const SourceSchema = z.enum([
  'whatsapp',
  'telegram',
  'email',
  'calendar',
  'cron',
  'internal',
]);

export const SignalTypeSchema = z.enum([
  'message',
  'calendar_event',
  'email',
  'cron_briefing',
  'approval_response',
  'follow_up_trigger',
]);

export const SignalSchema = z.object({
  id: z.string().uuid(),
  source: SourceSchema,
  type: SignalTypeSchema,
  raw_text: z.string(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).optional().default({}),
  sender_id: z.string().optional(),
});

export type Signal = z.infer<typeof SignalSchema>;
export type SignalSource = z.infer<typeof SourceSchema>;
export type SignalType = z.infer<typeof SignalTypeSchema>;

// ─── Classification Output ────────────────────────────────────────────────────

export const UrgencySchema = z.enum(['high', 'medium', 'low']);
export const IntentSchema = z.enum([
  'meeting_invite',
  'meeting_update',
  'meeting_cancel',
  'question',
  'approval',
  'action_item',
  'status_update',
  'general',
]);

export const ClassificationSchema = z.object({
  intent: IntentSchema,
  urgency: UrgencySchema,
  has_meeting: z.boolean(),
  meeting_id: z.string().nullable(),
  summary: z.string(),
  requires_response: z.boolean(),
});

export type Classification = z.infer<typeof ClassificationSchema>;

// ─── Schedule Optimizer Output ─────────────────────────────────────────────────

export const MeetingPrioritySchema = z.enum(['CRITICAL', 'IMPORTANT', 'OPTIONAL']);

export const ScoredEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string().datetime(),
  end: z.string().datetime(),
  location: z.string().nullable(),
  is_physical: z.boolean(),
  attendee_count: z.number(),
  priority: MeetingPrioritySchema,
  score: z.number().min(0).max(100),
  conference_link: z.string().nullable(),
});

export type ScoredEvent = z.infer<typeof ScoredEventSchema>;

// ─── Travel Agent Output ───────────────────────────────────────────────────────

export const TravelInfoSchema = z.object({
  meeting_id: z.string(),
  depart_by: z.string().datetime(),
  route_summary: z.string(),
  duration_minutes: z.number(),
  traffic_status: z.enum(['light', 'moderate', 'heavy']),
  weather_flag: z.enum(['clear', 'rain', 'storm', 'fog']),
  weather_description: z.string(),
});

export type TravelInfo = z.infer<typeof TravelInfoSchema>;

// ─── Agent Output Union ────────────────────────────────────────────────────────

export interface AgentOutput {
  agent: string;
  success: boolean;
  data: unknown;
  error?: string;
  whatsapp_message?: string;
  telegram_message?: string;
}

// ─── Approval State (stored in Redis) ─────────────────────────────────────────

export const ApprovalStateSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['auto_reply', 'follow_up']),
  draft: z.string(),
  context: z.record(z.unknown()),
  expires_at: z.string().datetime(),
});

export type ApprovalState = z.infer<typeof ApprovalStateSchema>;
