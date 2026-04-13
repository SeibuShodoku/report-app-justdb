import { z } from "zod";

const envSchema = z.object({
  JUSTDB_BASE_URL: z.string().url(),
  JUSTDB_API_TOKEN: z.string().min(1),
  JUSTDB_REPORT_ENDPOINT: z.string().min(1)
});

const reportPayloadSchema = z.object({
  title: z.string().min(1).max(120),
  reporter: z.string().min(1).max(80),
  category: z.string().min(1).max(50),
  content: z.string().min(1).max(4000)
});

export type ReportPayload = z.infer<typeof reportPayloadSchema>;

/**
 * 実行環境からJUST.DB連携設定を取得する。
 */
function getConfig() {
  return envSchema.parse({
    JUSTDB_BASE_URL: process.env.JUSTDB_BASE_URL,
    JUSTDB_API_TOKEN: process.env.JUSTDB_API_TOKEN,
    JUSTDB_REPORT_ENDPOINT: process.env.JUSTDB_REPORT_ENDPOINT
  });
}

/**
 * 報告書データをJUST.DB APIへ送信する。
 *
 * @param input 報告書データ
 * @throws 設定不備またはAPIレスポンスエラーの場合
 */
export async function createJustDbReport(input: unknown): Promise<void> {
  const payload = reportPayloadSchema.parse(input);
  const config = getConfig();

  const endpoint = new URL(config.JUSTDB_REPORT_ENDPOINT, config.JUSTDB_BASE_URL);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.JUSTDB_API_TOKEN}`
    },
    body: JSON.stringify(payload),
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`JUST.DB API error: ${response.status} ${body}`);
  }
}
