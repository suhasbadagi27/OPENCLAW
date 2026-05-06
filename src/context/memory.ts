import { Redis } from '@upstash/redis';
import { config } from '../config';

const redis = new Redis({
  url: config.redis.url,
  token: config.redis.token,
});

export { redis };

// ─── Memory Helper Functions ───────────────────────────────────────────────────

/** Store a key-value pair with optional TTL (seconds) */
export async function memSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await redis.setex(key, ttlSeconds, serialized);
  } else {
    await redis.set(key, serialized);
  }
}

/** Retrieve a value by key */
export async function memGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get<string>(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

/** Delete a key */
export async function memDel(key: string): Promise<void> {
  await redis.del(key);
}

/** Increment a counter (for pattern tracking) */
export async function memIncr(key: string): Promise<number> {
  return redis.incr(key);
}

/** Push item to a Redis list (for history tracking) */
export async function memListPush(key: string, value: unknown, maxLength = 100): Promise<void> {
  const serialized = JSON.stringify(value);
  await redis.lpush(key, serialized);
  await redis.ltrim(key, 0, maxLength - 1);
}

/** Get all items in a list */
export async function memListGet<T>(key: string, count = 50): Promise<T[]> {
  const items = await redis.lrange<string>(key, 0, count - 1);
  return items.map((item) => {
    try {
      return JSON.parse(item) as T;
    } catch {
      return item as unknown as T;
    }
  });
}

// ─── Pattern-specific helpers ──────────────────────────────────────────────────

export interface MeetingRecord {
  meeting_id: string;
  title: string;
  scheduled_start: string;
  actual_depart: string | null;
  was_on_time: boolean | null;
  meeting_type: string;
}

export async function recordMeetingOutcome(record: MeetingRecord): Promise<void> {
  await memListPush(`patterns:meetings:${record.meeting_type}`, record);
  await memListPush('patterns:meetings:all', record);
}

export async function getLatePatternsForType(meetingType: string): Promise<{
  late_count: number;
  total_count: number;
  habitual_late: boolean;
}> {
  const records = await memListGet<MeetingRecord>(`patterns:meetings:${meetingType}`, 20);
  const total = records.length;
  const lateCount = records.filter((r) => r.was_on_time === false).length;
  return {
    late_count: lateCount,
    total_count: total,
    habitual_late: total > 3 && lateCount / total > 0.5,
  };
}

export async function storeApprovalState(
  id: string,
  state: unknown,
  ttlSeconds = 3600
): Promise<void> {
  await memSet(`approval:${id}`, state, ttlSeconds);
}

export async function getApprovalState<T>(id: string): Promise<T | null> {
  return memGet<T>(`approval:${id}`);
}

export async function clearApprovalState(id: string): Promise<void> {
  await memDel(`approval:${id}`);
}
