import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cloud Run 向け：server.js＋最小依存だけの軽量成果物を出す（Dockerfile で利用）。
  output: "standalone",
  // puppeteer-core は動的 require を含むためバンドルせず外部依存として扱う
  // （standalone の file tracing に拾わせる）。Chromium 本体は Dockerfile で別途導入。
  serverExternalPackages: ["puppeteer-core"]
};

export default nextConfig;
