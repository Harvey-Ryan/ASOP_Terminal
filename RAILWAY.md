# Deploying to Railway

This guide walks through deploying ASOP Terminal to [Railway](https://railway.com).
The project splits into two Railway services:

| Service | Dockerfile | Purpose |
|---------|-----------|---------|
| **api-web** | `apps/api/Dockerfile` | Express API + compiled React SPA (same origin) |
| **bot** | `apps/bot/Dockerfile` | Discord bot + internal HTTP trigger server |

Both services share the same PostgreSQL database add-on.

---

## 1. Create a Railway project

1. Log in to [railway.com](https://railway.com) and click **New Project**.
2. Choose **Deploy from GitHub repo** and select this repository.
3. Railway will auto-detect the repo — **cancel** the default deployment for now; you will configure each service manually.

---

## 2. Add a PostgreSQL database

1. Inside the project, click **+ New** → **Database** → **PostgreSQL**.
2. Railway provisions a Postgres instance and automatically creates a `DATABASE_URL` variable you can reference with `${{Postgres.DATABASE_URL}}` in other services.

---

## 3. API + Web service

### 3a. Create the service

1. Click **+ New** → **GitHub Repo** (or **Empty Service** → connect repo).
2. In **Settings → Build** set:
   - **Build command** — leave empty (Dockerfile handles everything)
   - **Dockerfile path** → `apps/api/Dockerfile`
   - **Docker build context** → `.` (repo root)

### 3b. Set environment variables

| Variable | Value / notes |
|----------|--------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `SESSION_SECRET` | Generate with `openssl rand -hex 32` — keep secret |
| `DISCORD_CLIENT_ID` | Your Discord application's Client ID |
| `DISCORD_CLIENT_SECRET` | Your Discord application's Client Secret |
| `DISCORD_REDIRECT_URI` | `https://<your-api-web-domain>/api/auth/callback` |
| `DISCORD_TOKEN` | Your Discord bot token |
| `WEB_URL` | `https://<your-api-web-domain>` (same domain — CORS origin) |
| `BOT_INTERNAL_URL` | `http://<bot-service-name>.railway.internal:3002` (private network) |
| `BOT_INTERNAL_SECRET` | Any strong random string — must match the bot's value |
| `PORT` | `3001` (or leave unset; Railway injects its own PORT) |

> **Note on sessions:** Sessions are backed by PostgreSQL via `connect-pg-simple` and are persistent across restarts — no Redis required.

### 3c. Expose the service

In **Settings → Networking**, click **Generate Domain** to get a public HTTPS URL. Use this for `DISCORD_REDIRECT_URI` and `WEB_URL`.

### 3d. Discord OAuth redirect URL

In the [Discord Developer Portal](https://discord.com/developers/applications) → **OAuth2 → Redirects**, add:
```
https://<your-api-web-domain>/api/auth/callback
```

---

## 4. Bot service

### 4a. Create the service

Same as above but set:
- **Dockerfile path** → `apps/bot/Dockerfile`

The bot service does **not** need a public domain — it communicates with the API via Railway's private network only.

### 4b. Set environment variables

| Variable | Value / notes |
|----------|--------------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `DISCORD_TOKEN` | Your Discord bot token |
| `DISCORD_CLIENT_ID` | Your Discord application's Client ID |
| `BOT_INTERNAL_PORT` | `3002` (default, must match what API uses) |
| `BOT_INTERNAL_SECRET` | Same value set in the API service |
| `WEB_URL` | `https://<your-api-web-domain>` (dashboard links in all bot embeds — required) |
| `API_URL` | `http://<api-web-service-name>.railway.internal:3001` (internal image fetching — required) |

> **Why both URL vars?** `WEB_URL` is used throughout the bot to build clickable dashboard links in Discord embeds (event cards, tournament announcements, etc.). `API_URL` is used to fetch event images from the API service at runtime. Without these, links resolve to `localhost` and image embeds fail in production.

### 4c. Private networking

Railway services in the same project can reach each other at `<service-name>.railway.internal`. Set the API service's `BOT_INTERNAL_URL` to:

```
http://<bot-service-name>.railway.internal:3002
```

Replace `<bot-service-name>` with the slug shown in the bot service's Railway dashboard (e.g. `bot`, `dem-bot`).

> **Important:** Private networking uses the service's internal hostname, not the public domain. Never expose port 3002 publicly.

---

## 5. First-time deploy

1. **Trigger a deploy** on both services (push to main or click **Deploy** in the Railway UI).
2. The API service's container startup runs:
   ```
   npx prisma migrate deploy && npx tsx scripts/migrate-auctions.ts && node dist/index.js
   ```
   This applies all pending database migrations and runs a one-time data migration before the server starts.
3. Check **Logs** in both services to confirm a clean start:
   - API: `[API] Listening on http://localhost:…`
   - Bot: `[bot] Ready! Logged in as <BotName>#…`

---

## 6. Enable Privileged Gateway Intents

The bot requires two **privileged intents** that must be explicitly enabled in the Discord Developer Portal before the bot will function correctly.

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and select your application.
2. Navigate to **Bot → Privileged Gateway Intents**.
3. Enable both:
   - **Server Members Intent** — required to track voice channel attendance and member presence.
   - **Message Content Intent** — required to read message content in certain bot interactions.
4. Click **Save Changes**.

> Without these enabled, the bot will connect to Discord but silently fail to receive the events it needs.

---

## 7. Register Discord slash commands

After the bot service is running, register all slash commands once:

```bash
# From your local machine with a filled-in .env, or via Railway's shell:
cd apps/bot
node dist/deploy.js
```

This registers the following commands:

| Command | Purpose |
|---------|---------|
| `/event` | Create and manage events |
| `/login` | Authenticate with the web dashboard |
| `/bid` | Place a DKP auction bid |
| `/wallet` | View your DKP wallet |
| `/loot` | Interact with loot drafts |
| `/fleet` | Fleet ship lookup |
| `/whohas` | Search who owns a ship |
| `/blueprint` | Blueprint cost lookup |
| `/material` | Raw material lookup |
| `/recipe` | Crafting recipe lookup |
| `/uex` | UEX commodity price lookup |
| `/marketplace` | Org marketplace listings |
| `/help` | Command reference |

- Without `GUILD_ID` set → registers globally (takes ~1 hour to propagate to all servers).
- With `GUILD_ID=<your-guild-id>` → registers to that guild instantly (good for testing).

---

## 8. Invite the bot to your server

Generate an invite URL from the [Discord Developer Portal](https://discord.com/developers/applications) → **OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Bot permissions:

| Permission | Why it's needed |
|-----------|----------------|
| `View Channel` | Read channels and categories |
| `Send Messages` | Post event and tournament announcements |
| `Send Messages in Threads` | Post inside forum threads |
| `Embed Links` | Render rich embeds in messages |
| `Read Message History` | Fetch starter messages in forum threads |
| `Manage Channels` | Create and archive voice channels for events |
| `Manage Threads` | Archive threads and manage forum posts |
| `Manage Events` | Create Discord Scheduled Events |

---

## 9. Uploads (user-uploaded images)

The current setup stores uploaded images in `apps/api/uploads/` inside the container. **These are ephemeral** — they will be lost on redeploy. For production persistence either:

- Mount a Railway persistent volume at `/app/apps/api/uploads`, or
- Migrate image storage to an S3-compatible bucket (Cloudflare R2, AWS S3).

---

## 10. Tournament module

The Tournaments module is enabled per-guild from the web dashboard. Once enabled, configure it under **Settings → Tournaments**:

- **Announcement channel** — A forum channel where tournament bracket threads are automatically created and updated.
- **H2H announcement channel** — A text channel where head-to-head match results are announced.
- **Hide ELO ratings** — Hides the Rankings tab and ELO change summaries from members. Ratings are still calculated internally.

No additional environment variables are required for the tournament module.

---

## Optional integrations

These environment variables enable optional features. The app starts and runs normally without them.

### API + Web service

| Variable | Feature |
|----------|---------|
| `FLEETYARDS_CLIENT_ID` | FleetYards OAuth app client ID |
| `FLEETYARDS_CLIENT_SECRET` | FleetYards OAuth app client secret |
| `API_URL` | Public URL of this service — used as the FleetYards OAuth callback base URL |
| `UEX_KEY` | UEX Corp API key for weekly commodity price sync |
| `PUBLIC_SITE_URL` | Additional CORS origin (if the dashboard is served from a different domain) |
| `UPLOADS_DIR` | Override the default uploads directory path |
| `ROLECALL_API_URL` | RoleCall integration API base URL |
| `ROLECALL_API_KEY` | RoleCall integration API key |

---

## Environment variable summary

### API + Web service
```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=<random-32-bytes-hex>
DISCORD_CLIENT_ID=<app-client-id>
DISCORD_CLIENT_SECRET=<app-client-secret>
DISCORD_REDIRECT_URI=https://<domain>/api/auth/callback
DISCORD_TOKEN=<bot-token>
WEB_URL=https://<domain>
BOT_INTERNAL_URL=http://<bot-service>.railway.internal:3002
BOT_INTERNAL_SECRET=<shared-secret>
```

### Bot service
```
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
DISCORD_TOKEN=<bot-token>
DISCORD_CLIENT_ID=<app-client-id>
BOT_INTERNAL_PORT=3002
BOT_INTERNAL_SECRET=<shared-secret>
WEB_URL=https://<domain>
API_URL=http://<api-web-service>.railway.internal:3001
```
