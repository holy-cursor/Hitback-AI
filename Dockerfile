# HitBack backend + portal (monorepo)
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/extension/package.json ./packages/extension/

RUN npm ci --workspace=packages/backend

COPY packages/backend ./packages/backend
COPY frontend ./frontend

RUN npm run build --workspace=packages/backend

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

COPY package.json package-lock.json ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/extension/package.json ./packages/extension/

RUN npm ci --workspace=packages/backend --omit=dev

COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY frontend ./frontend

WORKDIR /app/packages/backend

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
