# Deploying to Railway

This guide walks through deploying Discord Event Manager to [Railway](https://railway.com).
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

> **Note on sessions:** The app uses an in-memory session store. Sessions are lost when the service restarts. For persistent sessions add a Redis add-on and replace the session store with `connect-redis`.

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
   npx prisma migrate deploy && node dist/index.js
   ```
   This applies all pending database migrations automatically before the server starts.
3. Check **Logs** in both services to confirm a clean start:
   - API: `[API] Listening on http://localhost:…`
   - Bot: `[bot] Ready! Logged in as <BotName>#…`

---

## 6. Register Discord slash commands

After the bot service is running, register the `/event` slash command once:

```bash
# From your local machine with a filled-in .env, or via Railway's shell:
cd apps/bot
node dist/deploy.js
```

- Without `GUILD_ID` set → registers globally (takes ~1 hour to propagate to all servers).
- With `GUILD_ID=<your-guild-id>` → registers to that guild instantly (good for testing).

---

## 7. Invite the bot to your server

Generate an invite URL from the [Discord Developer Portal](https://discord.com/developers/applications) → **OAuth2 → URL Generator**:
- Scopes: `bot`, `applications.commands`
- Bot permissions: `Manage Channels`, `Send Messages`, `Embed Links`, `Manage Events`, `View Channel`

---

## 8. Uploads (user-uploaded images)

The current setup stores uploaded images in `apps/api/uploads/` inside the container. **These are ephemeral** — they will be lost on redeploy. For production persistence either:

- Mount a Railway persistent volume at `/app/apps/api/uploads`, or
- Migrate image storage to an S3-compatible bucket (Cloudflare R2, AWS S3).

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
```
