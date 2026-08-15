# ---------------------------------------------------------------------------
# StockMan API — image de production (multi-stage, utilisateur non-root)
# Build depuis la RACINE du monorepo :  docker build -f apps/api/Dockerfile .
# ---------------------------------------------------------------------------

# ---- Étape 1 : compilation TypeScript -------------------------------------
FROM node:22-alpine AS build
WORKDIR /repo

# Manifests d'abord (cache des couches npm)
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

# Sources + migrations SQL (fichiers .sql lus au runtime par le runner)
COPY apps/api apps/api
COPY database database
RUN npm run build --workspace apps/api

# ---- Étape 2 : dépendances de production uniquement -----------------------
FROM node:22-alpine AS proddeps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --no-audit --no-fund

# ---- Étape 3 : image finale minimale --------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S stockman && adduser -S stockman -G stockman

COPY --from=proddeps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY database/migrations ./database/migrations
COPY database/seeds ./database/seeds
COPY scripts ./scripts
COPY apps/api/package.json ./package.json

USER stockman
EXPOSE 5000

# Migrations idempotentes au démarrage (la chaîne est rejouable), puis serveur.
# NODE_OPTIONS limite l'empreinte mémoire par défaut des petits VPS.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-5000}/api/health >/dev/null 2>&1 || exit 1

CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
