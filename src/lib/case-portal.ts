/**
 * 案件ポータルのデータ集約（サーバー専用）。
 *
 * `caseId` を鍵に「この案件にぶら下がる成果物」を集めて、各編集面への deep-link を組む。
 * 在庫の引き先：
 * - 写真報告書＝Supabase `photo_reports`（`case_id` 列・現在版・folder_id ごと）
 * - 防除作業報告書＝Supabase `prevention_reports`（同上）
 * - 確定成果物＝`case_deliverables`（案件キー・確定/顧客可視の索引）
 *
 * deep-link には起動トークンが要る（`/report/*` は token でフォルダ認可）。アプリ側で
 * `signLaunchToken` により**その場で短命トークンを採番**する（門は IAP・§case-access）。
 *
 * 仕様: docs/vision/case-portal.md §4.5（社内=顧客 同形の索引）
 */
import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";
import { signLaunchToken } from "@/lib/security/launch-token";
import { listDeliverables, type DeliverableEntry } from "@/lib/case-deliverables";
import type { CaseAccessScope } from "@/lib/security/case-access";
import type { ReportType } from "@/lib/report-versions";

/** ポータルに並ぶ1成果物（編集面への行）。 */
export type PortalReport = {
  reportType: ReportType;
  folderId: string;
  generatedAt: string | null;
  href: string; // token 採番済みの deep-link
};

export type CasePortal = {
  caseId: string;
  scope: CaseAccessScope;
  supabaseReady: boolean;
  photoReports: PortalReport[];
  preventionReports: PortalReport[];
  confirmed: DeliverableEntry[];
  estimateHref: string | null; // 見積（リング2・試作）。案件束縛は未配線のため caseId を素通し。
};

type ReportRow = { folder_id: string; case_id?: string; generated_at?: string | null };

/** 現在版テーブルから案件の成果物行を引く（folder_id と更新時刻のみ・並びは新しい順）。 */
async function loadReportRows(table: string, caseId: string): Promise<ReportRow[]> {
  const q =
    `${table}?case_id=eq.${encodeURIComponent(caseId)}` +
    `&select=folder_id,generated_at&order=generated_at.desc`;
  return sbSelect<ReportRow>(q);
}

/** report 行を deep-link 付きの PortalReport にする（token をその場で採番）。 */
function toPortalReport(
  reportType: ReportType,
  caseId: string,
  row: ReportRow,
  routePath: string
): PortalReport {
  const token = signLaunchToken({ caseId, driveFolderId: row.folder_id });
  const href =
    `${routePath}?folderId=${encodeURIComponent(row.folder_id)}` +
    `&token=${encodeURIComponent(token)}`;
  return { reportType, folderId: row.folder_id, generatedAt: row.generated_at ?? null, href };
}

/**
 * 案件の**最新**の写真報告書への deep-link（token 採番済み）。無ければ null。
 * Slack 📋報告書ボタンの直リンク（`/report/photo?caseId=` 入口）用：報告書は日付フォルダ単位の
 * 管理のため「その案件の報告書」は一意でない → **caseId はセレクタ、最新 1 件への解決をアプリが担う**。
 */
export async function latestPhotoReportHref(caseId: string): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  const rows = await loadReportRows("photo_reports", caseId);
  if (rows.length === 0) return null;
  return toPortalReport("photo", caseId, rows[0], "/report/photo").href;
}

/**
 * 案件ポータルの表示データを組む。
 * - scope="all"（裏・社内）＝現在版の編集面 + 確定索引を全部見せる。
 * - scope="customer-visible"（表・顧客）＝確定・顧客可視の成果物のみ（編集面は出さない）。
 */
export async function loadCasePortal(
  caseId: string,
  scope: CaseAccessScope
): Promise<CasePortal> {
  const supabaseReady = supabaseConfigured();
  const empty: CasePortal = {
    caseId,
    scope,
    supabaseReady,
    photoReports: [],
    preventionReports: [],
    confirmed: [],
    estimateHref: scope === "all" ? `/estimate?caseId=${encodeURIComponent(caseId)}` : null
  };
  if (!supabaseReady) return empty;

  if (scope === "customer-visible") {
    // 表：確定・顧客可視の凍結成果物だけ（編集面・見積の作成面は出さない）。
    const confirmed = await listDeliverables(caseId, { customerVisibleOnly: true });
    return { ...empty, confirmed, estimateHref: null };
  }

  // 裏：現在版の編集面（写真/防除）＋ 確定索引をすべて。
  const [photoRows, preventionRows, confirmed] = await Promise.all([
    loadReportRows("photo_reports", caseId),
    loadReportRows("prevention_reports", caseId),
    listDeliverables(caseId)
  ]);

  return {
    ...empty,
    photoReports: photoRows.map((r) => toPortalReport("photo", caseId, r, "/report/photo")),
    preventionReports: preventionRows.map((r) =>
      toPortalReport("prevention", caseId, r, "/report/prevention")
    ),
    confirmed
  };
}
