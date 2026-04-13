import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "報告書作成アプリ",
  description: "JUST.DB連携の報告書作成アプリ"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
