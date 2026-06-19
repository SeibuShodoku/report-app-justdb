/**
 * 写真報告書の生成設定（`photo_report_settings`）の読み書き（サーバー専用）。
 * 設定モーダルが upsert、ページ（プリフィル）と VM ワーカー（プロンプト反映）が読む。
 * DB は snake_case、アプリは camelCase（zod）。ここで相互変換する。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §6.5
 */
import { sbSelect, sbUpsert, supabaseConfigured } from "@/lib/supabase-rest";
import {
  DEFAULT_SETTINGS,
  photoReportSettingsSchema,
  type PhotoReportSettings
} from "@/schemas/photo-report-settings";

type SettingsRow = {
  folder_id: string;
  report_type: string | null;
  exec_date: string | null;
  property_name: string | null;
  reporter: string | null;
  tone_politeness: string | null;
  response_mode: string | null;
  proposal_weight: string | null;
  client_type: string | null;
};

function rowToSettings(row: SettingsRow): PhotoReportSettings {
  // 不正値が混じっても既定へ寄せる（safeParse 的に1項目ずつは難しいので緩く parse）。
  return photoReportSettingsSchema.parse({
    reportType: row.report_type ?? undefined,
    execDate: row.exec_date ?? undefined,
    propertyName: row.property_name ?? undefined,
    reporter: row.reporter ?? undefined,
    tonePoliteness: row.tone_politeness ?? undefined,
    responseMode: row.response_mode ?? undefined,
    proposalWeight: row.proposal_weight ?? undefined,
    clientType: row.client_type ?? undefined
  });
}

/** フォルダの設定を読む。未設定・未構成・失敗時は既定設定にフォールバック。 */
export async function loadSettings(folderId: string): Promise<PhotoReportSettings> {
  if (!supabaseConfigured()) return DEFAULT_SETTINGS;
  try {
    const rows = await sbSelect<SettingsRow>(
      `photo_report_settings?folder_id=eq.${encodeURIComponent(folderId)}&select=*&limit=1`
    );
    return rows[0] ? rowToSettings(rows[0]) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** フォルダの設定を upsert（folder_id キー）。 */
export async function saveSettings(
  folderId: string,
  s: PhotoReportSettings
): Promise<void> {
  await sbUpsert(
    "photo_report_settings",
    {
      folder_id: folderId,
      report_type: s.reportType,
      exec_date: s.execDate ?? null,
      property_name: s.propertyName ?? null,
      reporter: s.reporter ?? null,
      tone_politeness: s.tonePoliteness,
      response_mode: s.responseMode,
      proposal_weight: s.proposalWeight,
      client_type: s.clientType,
      updated_at: new Date().toISOString()
    },
    "folder_id"
  );
}
