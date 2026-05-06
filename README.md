# 🦾 OpenClaw

> Pure backend intelligent personal assistant. No app. No login. WhatsApp is your only interface.

OpenClaw watches your calendar, messages, email, and location context. It proactively helps you before, during, and after every meeting — delivered entirely through WhatsApp or Telegram.

---

## Quick Start

```bash
git clone <your-repo>
cd openclaw
cp .env.example .env       # Fill in your credentials
npm install
npm run dev
```

---

## Architecture

```
Trigger Layer  →  Signal Ingest  →  AI Classifier  →  Orchestrator
                                                           │
                        ┌──────────────────────────────────┤
                        │          Agents                  │
                        ├─ Schedule Optimizer              │
                        ├─ Travel Agent (Maps + Weather)   │
                        ├─ Briefing Engine (7 AM cron)     │
                        ├─ Auto Responder (draft + approve)│
                        ├─ Follow-up Agent (post-meeting)  │
                        └─ Learning Agent (Redis patterns) │
                                                           │
                        ┌──────────────────────────────────┘
                        ▼
                  WhatsApp / Telegram
```

---

## Daily Flow

```
07:00  Briefing Engine fires
       → WhatsApp: "Good morning. 3 meetings today..."

09:05  Travel Agent fires (for 10 AM physical meeting)
       → WhatsApp: "Leave now — traffic + rain. ETA 45 mins."

09:20  Follow-up reminder (if no LEFT command received)
       → "You haven't left yet. You may be late."

10:00  Meeting starts

10:55  Follow-up Agent fires (5 min after meeting end)
       → "Meeting finished. Reply SUMMARY <id> for AI summary."

21:00  Evening digest
       → Pending action items, tomorrow's first meeting preview
```

---

## WhatsApp Commands

| Command | Action |
|---|---|
| `TODAY` | Re-send morning briefing |
| `LEFT` | Record departure for next physical meeting |
| `INSIGHTS` | View punctuality patterns |
| `SUMMARY <id>` | Get post-meeting AI summary |
| `SEND <id>` | Approve a draft reply |
| `EDIT <id> <text>` | Send custom reply instead |
| `SKIP <id>` | Discard a draft |
| `HELP` | Show all commands |

---

## Integration Steps

### Step 1 — Twilio (WhatsApp)

1. Sign up at [twilio.com](https://twilio.com)
2. Go to **Messaging → Try it out → Send a WhatsApp message**
3. Join the Twilio Sandbox (send the join code from your phone)
4. In the Twilio Console:
   - Copy **Account SID** → `TWILIO_ACCOUNT_SID`
   - Copy **Auth Token** → `TWILIO_AUTH_TOKEN`
   - The WhatsApp from number is `whatsapp:+14155238886` (sandbox) → `TWILIO_WHATSAPP_FROM`
5. Set webhook URL in sandbox settings:
   - `https://your-app.up.railway.app/webhook/whatsapp`
   - Method: **HTTP POST**
6. Your number: `whatsapp:+91XXXXXXXXXX` → `USER_WHATSAPP_NUMBER`

> **Production**: Apply for WhatsApp Business API to remove sandbox restrictions.

---

### Step 2 — Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the bot token → `TELEGRAM_BOT_TOKEN`
4. Start a chat with your new bot
5. Get your chat ID:
   - Send a message to the bot
   - Visit: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Find `"chat":{"id": XXXXXXX}` → `USER_TELEGRAM_CHAT_ID`

---

### Step 3 — Google Calendar API

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project → **"OpenClaw"**
3. Enable these APIs:
   - **Google Calendar API**
   - **Google Maps JavaScript API**
   - **Directions API**
   - **Geocoding API**
4. Go to **Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Add redirect URI: `http://localhost:3000/oauth/callback`
5. Copy **Client ID** → `GOOGLE_CALENDAR_CLIENT_ID`
6. Copy **Client Secret** → `GOOGLE_CALENDAR_CLIENT_SECRET`

**Generate the refresh token** (one-time):
```bash
# Install the Google OAuth helper
npx --yes google-auth-library-node-auth-code-flow
# OR run this in Node:
```

```js
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, 'http://localhost:3000');
const url = client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.readonly']
});
console.log('Open this URL:', url);
// After auth, exchange the code:
const { tokens } = await client.getToken(CODE_FROM_URL);
console.log('Refresh token:', tokens.refresh_token);
```

Copy the refresh token → `GOOGLE_CALENDAR_REFRESH_TOKEN`

---

### Step 4 — Google Maps API

1. In Google Cloud Console → **Credentials → Create API Key**
2. Restrict to: **Directions API**, **Geocoding API**
3. Copy key → `GOOGLE_MAPS_API_KEY`

---

### Step 5 — OpenWeather API

1. Sign up at [openweathermap.org](https://openweathermap.org/api)
2. Go to **API Keys** → copy your key → `OPENWEATHER_API_KEY`
3. Free tier: 1,000 calls/day — more than enough

---

### Step 6 — Anthropic (Claude AI)

1. Sign up at [console.anthropic.com](https://console.anthropic.com)
2. Go to **API Keys → Create Key**
3. Copy key → `ANTHROPIC_API_KEY`
4. The system uses `claude-sonnet-4-20250514` by default

---

### Step 7 — Upstash Redis (Memory)

1. Sign up at [upstash.com](https://upstash.com)
2. Create a **Redis database** (free tier: 10,000 commands/day)
3. Copy **REST URL** → `UPSTASH_REDIS_URL`
4. Copy **REST Token** → `UPSTASH_REDIS_TOKEN`

---

### Step 8 — Railway Deployment

1. Sign up at [railway.app](https://railway.app)
2. New Project → **Deploy from GitHub repo**
3. Add all environment variables from `.env` in the Railway dashboard
4. Railway auto-detects Node.js and runs `npm start`
5. Get your public URL → set as `WEBHOOK_BASE_URL`
6. Update Twilio webhook URL to: `https://your-app.up.railway.app/webhook/whatsapp`

**railway.toml** (optional, auto-detected):
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "npm start"
healthcheckPath = "/health"
restartPolicyType = "on_failure"
```

---

### Step 9 — Gmail IMAP (Optional)

If you want email-based triggers:
1. In Gmail: **Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP**
2. Create an [App Password](https://myaccount.google.com/apppasswords) (requires 2FA)
3. Set in `.env`:
   ```
   IMAP_HOST=imap.gmail.com
   IMAP_USER=your@gmail.com
   IMAP_PASSWORD=<16-char app password>
   ```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | ✅ | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | ✅ | Twilio auth token |
| `TWILIO_WHATSAPP_FROM` | ✅ | Twilio WhatsApp number |
| `TELEGRAM_BOT_TOKEN` | ✅ | Telegram bot token |
| `GOOGLE_CALENDAR_CLIENT_ID` | ✅ | Google OAuth client ID |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | ✅ | Google OAuth secret |
| `GOOGLE_CALENDAR_REFRESH_TOKEN` | ✅ | OAuth refresh token |
| `GOOGLE_MAPS_API_KEY` | ✅ | Maps + Directions API key |
| `ANTHROPIC_API_KEY` | ✅ | Claude API key |
| `OPENWEATHER_API_KEY` | ✅ | OpenWeather API key |
| `UPSTASH_REDIS_URL` | ✅ | Upstash Redis REST URL |
| `UPSTASH_REDIS_TOKEN` | ✅ | Upstash Redis REST token |
| `USER_WHATSAPP_NUMBER` | ✅ | Your WhatsApp number `whatsapp:+91...` |
| `USER_HOME_ADDRESS` | ✅ | Home address for travel calculations |
| `USER_TIMEZONE` | ✅ | IANA timezone (default: Asia/Kolkata) |
| `USER_TELEGRAM_CHAT_ID` | ⬜ | Your Telegram chat ID |
| `WEBHOOK_BASE_URL` | ✅ | Public URL of your deployed server |
| `PORT` | ⬜ | Server port (default: 3000) |
| `IMAP_HOST` | ⬜ | IMAP host for email (optional) |
| `IMAP_USER` | ⬜ | IMAP email address (optional) |
| `IMAP_PASSWORD` | ⬜ | IMAP app password (optional) |

---

## Agent Reference

| Agent | Trigger | Output |
|---|---|---|
| Signal Ingest | All | Unified Signal schema |
| AI Classifier | Every signal | Intent + urgency |
| Schedule Optimizer | Calendar events | CRITICAL/IMPORTANT/OPTIONAL tags |
| Travel Agent | Physical meetings | Departure alert via WhatsApp |
| Briefing Engine | 7 AM cron | Full day summary |
| Auto Responder | Meeting invites / messages | Draft reply for approval |
| Follow-up Agent | 5 min after meeting end | Summary + action items |
| Learning Agent | All meeting outcomes | Pattern tracking + buffer adaptation |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| Web server | Express.js |
| Validation | Zod |
| AI | Anthropic Claude (claude-sonnet-4-20250514) |
| WhatsApp | Twilio API |
| Telegram | node-telegram-bot-api |
| Calendar | googleapis |
| Maps | @googlemaps/google-maps-services-js |
| Weather | OpenWeather REST API |
| Memory | @upstash/redis |
| Scheduler | node-cron |
| Email | imapflow |
| Deployment | Railway.app |

---

## License

MIT — Built for personal use. Extend freely.
