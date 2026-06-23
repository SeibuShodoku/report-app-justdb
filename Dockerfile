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

# サーバー側PDF生成（/api/photo-report/pdf）用に Chromium と日本語フォントを導入。
# - chromium: ヘッドレスで印刷ビューを A4 PDF 化（Puppeteer は本体を別途要求＝puppeteer-core）
# - fonts-noto-cjk: 無いと日本語が豆腐(□)になる＝必須
# - dumb-init: Chromium が産む子プロセスを PID1 で回収（孤児/ゾンビ防止）
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-noto-cjk dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# standalone は server.js と最小 node_modules を含む。static/public は別途同梱が必要。
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 8080
# dumb-init を PID1 に（Chromium のゾンビ回収）。
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
