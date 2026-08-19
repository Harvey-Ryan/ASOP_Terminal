# ── Discord Event Manager — Bot service ─────────────────────────────────────
# Builds only the Discord bot. The API+Web service runs separately.

FROM node:20-alpine
WORKDIR /app

# Copy workspace manifests
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/

# Bot's prisma config points to ../api/prisma/schema.prisma.
# The API postinstall (`prisma generate`) also runs during npm ci here,
# generating the Prisma client that the bot shares.
COPY apps/api/prisma/ apps/api/prisma/

# Install DejaVu fonts for resvg-js text rendering.
# Alpine's ttf-dejavu installs to an unpredictable sub-path depending on version,
# so we copy the files to a fixed /fonts/ directory that bracketSvg.ts can
# reference unconditionally — no runtime path discovery needed.
RUN apk add --no-cache ttf-dejavu \
  && mkdir -p /fonts \
  && find /usr/share/fonts -name "DejaVuSans.ttf"      2>/dev/null | head -1 | xargs -I{} cp {} /fonts/ \
  && find /usr/share/fonts -name "DejaVuSans-Bold.ttf" 2>/dev/null | head -1 | xargs -I{} cp {} /fonts/ \
  && echo "Fonts copied: $(ls /fonts/)"

# Install all workspace deps
RUN npm ci

# Copy bot source (packages/shared built as a TS project reference)
COPY packages/ packages/
COPY apps/bot/ apps/bot/

RUN npx turbo run build --filter=@dem/bot...

WORKDIR /app/apps/bot
ENV NODE_ENV=production
EXPOSE 3002

CMD ["node", "dist/index.js"]
