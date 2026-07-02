/**
 * 案件ポータルのデータ集約（サーバー専用）。
 *
 * `caseId` を鍵に「この案件の**写真報告書**」を集めて、編集面への deep-link を組む。
 * ポータルは写真報告書の管理面（2026-07-02 決定＝見積・防除は載せない）：
 * - 一覧＝Supabase `photo_reports`（`case_id` 列・現在版・folder_id＝日付フォルダごと）
 * - 正本＝案件フォルダ `_ai/canonical-report.json`（人が指定・AI が前回参照に使う）
 * - 確定成果物＝`case_deliverables`（photo のみ表示・リング1c の入口）
 *
 * deep-link には起動トークンが要る（`/report/*` は token でフォルダ認可）。アプリ側で
 * `signLaunchToken` により**その場で短命トークンを採番**する（門は IAP・§case-access）。
 *
 * 仕様: docs/vision/case-portal.md §7.5（写真報告書の版管理・正本）
 */
import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";
import { signLaunchToken } from "@/lib/security/launch-token";
import { listDeliverables, type DeliverableEntry } from "@/lib/case-deliverables";
import { readCanonicalReport } from "@/lib/case-canonical";
import { driveConfigured, driveGetFileMeta } from "@/lib/drive";
import { getParentId } from "@/lib/drive-write";
import type { CaseAccessScope } from "@/lib/security/case-access";
import type { ReportType } from "@/lib/report-versions";

/** ポータルに並ぶ1報告書（編集面への行）。 */
export type PortalReport = {
  reportType: ReportType;
  folderId: string;
  /** 日付フォルダ名（写真_YYYYMMDD）。Drive から引けない時は null。 */
  folderName: string | null;
  generatedAt: string | null;
  href: string; // token 採番済みの deep-link
  isCanonical: boolean;
};

export type CasePortal = {
  caseId: string;
  scope: CaseAccessScope;
  supabaseReady: boolean;
  photoReports: PortalReport[];
  confirmed: DeliverableEntry[];
  /** 案件フォルダ（topFolderId 引数 or 日付フォルダの親から解決）。新規作成リンクに使う。 */
  caseFolderId: string | null;
  /** 正本の日付フォルダID（未指定なら null）。 */
  canonicalFolderId: string | null;
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
): Omit<PortalReport, "folderName" | "isCanonical"> {
  const token = signLaunchToken({ caseId, driveFolderId: row.folder_id });
  const href =
    `${routePath}?folderId=${encodeURIComponent(row.folder_id)}` +
    `&token=${encodeURIComponent(token)}`;
  return { reportType, folderId: row.folder_id, generatedAt: row.generated_at ?? null, href };
}

/** フォルダ名をまとめて引く（失敗した分は null＝表示は folderId 尻尾で代替）。 */
async function loadFolderNames(folderIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!driveConfigured()) return names;
  await Promise.all(
    folderIds.map(async (id) => {
      try {
        const meta = await driveGetFileMeta(id);
        if (meta.name) names.set(id, meta.name);
      } catch {
        /* 表示用のみ＝欠けても致命でない */
      }
    })
  );
  return names;
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
 * 案件ポータルの表示データを組む（写真報告書のみ）。
 * - scope="all"（裏・社内）＝現在版の編集面＋正本指定＋確定索引（photo）。
 * - scope="customer-visible"（表・顧客）＝確定・顧客可視の成果物のみ（編集面は出さない）。
 * @param topFolderId Slack ボタンの URL に載る案件フォルダID（新規作成リンク用）。
 *   無ければ日付フォルダの親から解決する。
 */
export async function loadCasePortal(
  caseId: string,
  scope: CaseAccessScope,
  topFolderId?: string | null
): Promise<CasePortal> {
  const supabaseReady = supabaseConfigured();
  const empty: CasePortal = {
    caseId,
    scope,
    supabaseReady,
    photoReports: [],
    confirmed: [],
    caseFolderId: topFolderId || null,
    canonicalFolderId: null
  };
  if (!supabaseReady) return empty;

  if (scope === "customer-visible") {
    // 表：確定・顧客可視の凍結成果物だけ（編集面は出さない）。
    const confirmed = await listDeliverables(caseId, { customerVisibleOnly: true });
    return { ...empty, confirmed: confirmed.filter((d) => d.report_type === "photo") };
  }

  // 裏：写真報告書の現在版（日付フォルダごと）＋ 確定索引（photo のみ）。
  const [photoRows, confirmedAll] = await Promise.all([
    loadReportRows("photo_reports", caseId),
    listDeliverables(caseId)
  ]);

  // 案件フォルダ＝topFolderId 優先、無ければ先頭行の親（Drive 1 呼び出し）。
  let caseFolderId = topFolderId || null;
  if (!caseFolderId && photoRows.length > 0) {
    try {
      caseFolderId = await getParentId(photoRows[0].folder_id);
    } catch {
      caseFolderId = null;
    }
  }

  const [names, canonical] = await Promise.all([
    loadFolderNames(photoRows.map((r) => r.folder_id)),
    caseFolderId ? readCanonicalReport(caseFolderId) : Promise.resolve(null)
  ]);
  const canonicalFolderId = canonical?.folderId ?? null;

  return {
    ...empty,
    caseFolderId,
    canonicalFolderId,
    photoReports: photoRows.map((r) => ({
      ...toPortalReport("photo", caseId, r, "/report/photo"),
      folderName: names.get(r.folder_id) ?? null,
      isCanonical: r.folder_id === canonicalFolderId
    })),
    confirmed: confirmedAll.filter((d) => d.report_type === "photo")
  };
}
