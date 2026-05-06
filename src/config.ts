import 'dotenv/config';

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? 'http://localhost:3000',

  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  },

  google: {
    calendarClientId: requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
    calendarClientSecret: requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
    calendarRefreshToken: requireEnv('GOOGLE_CALENDAR_REFRESH_TOKEN'),
    mapsApiKey: requireEnv('GOOGLE_MAPS_API_KEY'),
    gmailClientId: process.env.GMAIL_CLIENT_ID,
    gmailClientSecret: process.env.GMAIL_CLIENT_SECRET,
    gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN,
  },

  anthropic: {
    apiKey: requireEnv('ANTHROPIC_API_KEY'),
  },

  openweather: {
    apiKey: requireEnv('OPENWEATHER_API_KEY'),
  },

  redis: {
    url: requireEnv('UPSTASH_REDIS_URL'),
    token: requireEnv('UPSTASH_REDIS_TOKEN'),
  },

  user: {
    telegramChatId: requireEnv('USER_TELEGRAM_CHAT_ID'),
    homeAddress: requireEnv('USER_HOME_ADDRESS'),
    timezone: process.env.USER_TIMEZONE ?? 'Asia/Kolkata',
  },
};
