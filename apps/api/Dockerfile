# ── Discord Event Manager — API + Web service ────────────────────────────────
# Builds the shared package, React SPA, and Express API in one image.
# In production Express serves the compiled SPA from ../web/dist.

FROM node:20-alpine
WORKDIR /app

# Copy workspace manifests first so npm ci layer is cached separately
COPY package.json package-lock.json turbo.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Bot manifest needed so npm workspaces doesn't complain about a missing package
COPY apps/bot/package.json apps/bot/

# Prisma schema must exist BEFORE npm ci — the API postinstall runs `prisma generate`
COPY apps/api/prisma/ apps/api/prisma/

# Install all workspace deps (includes devDeps needed for TS compilation)
RUN npm ci

# Copy source for the packages we need to build
COPY packages/ packages/
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/

# Build: shared → api (tsc) AND shared → web (vite)
RUN npx turbo run build --filter=@dem/api... --filter=@dem/web...

# API runs from apps/api so that:
#   - `prisma migrate deploy` finds prisma/schema.prisma
#   - path.resolve(cwd, '../web/dist') resolves to /app/apps/web/dist
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
