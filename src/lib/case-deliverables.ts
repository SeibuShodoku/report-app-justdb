/**
 * 確定成果物マニフェスト（`case_deliverables`）の登録・一覧（サーバー専用）。
 *
 * 案件単位で「確定した成果物」を時系列に並べた索引。**社内編集面と顧客提示面が同じこの索引を
 * 同じレンダラで描く**ことで「同じ見え方」を成立させる単一ソース（vision §4.5）。
 * 中身の正本は Drive（`_ai/reports/<folder_id>/.../v{version}.json` ＋ 写真凍結 `_ai/assets/<deliverableId>/`）。
 * 本表はそれを指す索引で、Drive から再生成できる。
 *
 * 仕様: docs/vision/case-portal.md §4.5 / docs/spec/ring1a-prevention-report.md D6
 */
import { sbSelect, sbUpsert } from "@/lib/supabase-rest";
import type { ReportType } from "@/lib/report-versions";

export type DeliverableEntry = {
  deliverable_id: string;
  case_id: string;
  report_type: ReportType;
  stage?: string | null;
  folder_id: string;
  version: number;
  assets_path?: string | null;
  title?: string | null;
  customer_visible: boolean;
  confirmed_by?: string | null;
  confirmed_at?: string;
};

/** 確定単位の安定ID。写真/防除が folder_id を共有しても衝突しないよう reportType を含める。 */
export function deliverableId(reportType: ReportType, folderId: string, version: number): string {
  return `${reportType}:${folderId}:v${version}`;
}

/** 確定成果物をマニフェストへ登録（再確定は deliverable_id で冪等更新）。 */
export async function registerDeliverable(args: {
  caseId: string;
  reportType: ReportType;
  folderId: string;
  version: number;
  stage?: string;
  assetsPath?: string | null;
  title?: string;
  customerVisible?: boolean;
  confirmedBy?: string | null;
}): Promise<{ deliverableId: string }> {
  const id = deliverableId(args.reportType, args.folderId, args.version);
  await sbUpsert(
    "case_deliverables",
    {
      deliverable_id: id,
      case_id: args.caseId,
      report_type: args.reportType,
      stage: args.stage ?? null,
      folder_id: args.folderId,
      version: args.version,
      assets_path: args.assetsPath ?? null,
      title: args.title ?? null,
      customer_visible: args.customerVisible ?? false,
      confirmed_by: args.confirmedBy ?? null,
      confirmed_at: new Date().toISOString()
    },
    "deliverable_id"
  );
  return { deliverableId: id };
}

/** 案件の確定成果物を時系列（古い順）で返す。customerVisibleOnly=true で顧客可視のみ（顧客面用）。 */
export async function listDeliverables(
  caseId: string,
  opts: { customerVisibleOnly?: boolean } = {}
): Promise<DeliverableEntry[]> {
  let q = `case_deliverables?case_id=eq.${encodeURIComponent(caseId)}&order=confirmed_at.asc`;
  if (opts.customerVisibleOnly) q += "&customer_visible=is.true";
  return sbSelect<DeliverableEntry>(q);
}
