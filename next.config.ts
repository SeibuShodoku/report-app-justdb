import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Cloud Run 向け：server.js＋最小依存だけの軽量成果物を出す（Dockerfile で利用）。
  output: "standalone"
};

export default nextConfig;
