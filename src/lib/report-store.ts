import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { reportSubmissionSchema, type ReportSubmission } from "@/schemas/report";

const envSchema = z.object({
  REPORT_STORAGE_DIR: z.string().min(1).optional()
});

type StoredReport = Omit<ReportSubmission, "token"> & {
  reportId: string;
  createdAt: string;
};

/**
 * 報告書保存先ディレクトリを取得する。
 */
function getStorageDir(): string {
  const env = envSchema.parse({ REPORT_STORAGE_DIR: process.env.REPORT_STORAGE_DIR });
  return env.REPORT_STORAGE_DIR ?? "data/reports";
}

/**
 * 報告書データをアプリ側ストレージへ保存する。
 * JUST.DBへの書き戻しは行わない。
 *
 * @param input 検証対象の報告書データ
 * @returns 保存された報告書ID
 */
export async function saveReport(input: unknown): Promise<string> {
  const submission = reportSubmissionSchema.parse(input);
  const reportId = randomUUID();

  const { token, ...reportBody } = submission;
  void token;
  const stored: StoredReport = {
    ...reportBody,
    reportId,
    createdAt: new Date().toISOString()
  };

  const storageDir = getStorageDir();
  await mkdir(storageDir, { recursive: true });

  const targetPath = join(storageDir, `${reportId}.json`);
  await writeFile(targetPath, JSON.stringify(stored, null, 2), "utf-8");

  return reportId;
}
