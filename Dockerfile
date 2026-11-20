FROM node:20-alpine
# openssl: required by Prisma; ttf-dejavu: fonts for resvg-js bracket/match-card images.
# Alpine puts ttf-dejavu in a version-dependent sub-path, so we use `find` to locate
# the files and copy them to a fixed /fonts/ directory that bracketSvg.ts loads directly.
RUN apk add --no-cache openssl ttf-dejavu \
  && mkdir -p /fonts \
  && find /usr/share/fonts -name "DejaVuSans.ttf"      2>/dev/null | head -1 | xargs -I{} cp {} /fonts/ \
  && find /usr/share/fonts -name "DejaVuSans-Bold.ttf" 2>/dev/null | head -1 | xargs -I{} cp {} /fonts/ \
  && echo "Fonts staged: $(ls /fonts/)"
WORKDIR /app

COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
COPY apps/api/prisma/ apps/api/prisma/
RUN npm ci

COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/
COPY apps/bot/ apps/bot/

# Vite bakes VITE_* vars into the bundle at build time — must be passed as build args
ARG VITE_DISCORD_CLIENT_ID
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID

RUN npx turbo run build --force --filter=@dem/api... --filter=@dem/web... --filter=@dem/bot...

ENV NODE_ENV=production
# Bot runs in the same container — no inter-service networking needed
ENV BOT_INTERNAL_URL=http://127.0.0.1:3002

EXPOSE 3001

# scripts/start.mjs: refuses to start (and never touches the database) without
# the app's own secrets, runs `prisma db push`, then the bot and the API; if
# either stops, the container exits so Railway restarts it.
COPY scripts/start.mjs scripts/start.mjs
CMD ["node", "scripts/start.mjs"]
