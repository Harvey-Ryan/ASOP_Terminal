# ── ASOP sc-data worker ─────────────────────────────────────────────────────
# Mirrors StarCitizenWiki/scunpacked-data into Postgres (schemas scdata_raw and
# scdata). Runs on a Railway cron schedule, does its work, and exits.
# Build context: repo root.

FROM node:20-alpine
WORKDIR /app

# Workspace manifests (npm needs the root + this workspace to install)
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/sc-data/package.json apps/sc-data/

# Only this workspace's dependencies; skip other workspaces' install scripts (Prisma).
RUN npm ci --workspace @dem/sc-data --ignore-scripts --no-audit --no-fund

COPY apps/sc-data/ apps/sc-data/
RUN npm run build --workspace @dem/sc-data

ENV NODE_ENV=production
# Keeps the heap small; a full first load of every file peaks around 500 MB total.
ENV NODE_OPTIONS=--max-old-space-size=384

CMD ["node", "apps/sc-data/dist/index.js"]
