FROM node:20-alpine
RUN apk add --no-cache openssl
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
ENV BOT_INTERNAL_URL=http://localhost:3002

EXPOSE 3001

# Start bot in background, then run API (with migration) in foreground
CMD ["sh", "-c", "node apps/bot/dist/index.js & cd apps/api && npx prisma db push --accept-data-loss && node dist/index.js"]
