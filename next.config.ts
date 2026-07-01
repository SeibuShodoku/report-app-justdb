import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cloud Run 向け：server.js＋最小依存だけの軽量成果物を出す（Dockerfile で利用）。
  output: "standalone",
  // puppeteer-core は動的 require を含むためバンドルせず外部依存として扱う
  // （standalone の file tracing に拾わせる）。Chromium 本体は Dockerfile で別途導入。
  serverExternalPackages: ["puppeteer-core"],
  // 報告書ページの HTML はキャッシュさせない（Slack/Gmail 等のアプリ内ブラウザが古い HTML＝
  // 古い CSS 参照を握り続け、レイアウト崩れが直らない問題への対策）。静的アセットは
  // 内容ハッシュ名なので従来どおり長期キャッシュされる（このヘッダは HTML 応答に効く）。
  async headers() {
    return [
      {
        source: "/report/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }]
      }
    ];
  }
};

export default nextConfig;
