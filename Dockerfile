# report-app-justdb を Cloud Run で動かすための多段ビルド（Next.js standalone）。
# 仕様: docs/runbook/deploy-vercel.md / docs/spec/slack-photo-report*.md
# 秘密は .env を焼き込まず、Cloud Run の env（--env-vars-file 等）で注入する。

# ---- deps: 依存だけ先に入れてキャッシュを効かせる ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: 本番ビルド（standalone 出力） ----
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner: standalone 成果物だけで起動 ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
# standalone は server.js と最小 node_modules を含む。static/public は別途同梱が必要。
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 8080
CMD ["node", "server.js"]
