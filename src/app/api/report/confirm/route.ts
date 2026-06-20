import { driveWriteConfigured } from "@/lib/drive-write";
import { registerDeliverable } from "@/lib/case-deliverables";
import { listReportVersions as listPreventionVersions } from "@/lib/prevention-report-store";
import { iapUserEmail } from "@/lib/security/iap-user";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";
import { supabaseConfigured } from "@/lib/supabase-rest";

export const runtime = "nodejs";

/**
 * 報告書を「確定（公開）」する＝確定成果物マニフェスト（`case_deliverables`）へ登録。
 * 社内/顧客 共通レンダラの単一ソースに乗せ、`customerVisible=true` で顧客可視の起点になる。
 * - 防除（紺谷V）: 写真を持たないため**登録のみ**（凍結なし）。
 * - 写真: 写真凍結（`_ai/assets/<deliverableId>/`）を伴うため**本エンドポイントでは未対応**（1c 配線時に実装）。
 * 例: POST /api/report/confirm?folderId=DIR&token=...
 *     body={ reportType:"prevention", version?, stage?, title?, customerVisible? }
 */
export async function POST(request: Request) {
  if (!driveWriteConfigured() || !supabaseConfigured()) {
    return Response.json({ error: "Drive書込/Supabase 未設定。" }, { status: 503 });
  }
  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId")?.trim();
  if (!folderId) {
    return Response.json({ error: "folderId が必要です。" }, { status: 400 });
  }
  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  if (auth.mode !== "browser") {
    return Response.json({ error: "確定は人の操作に限ります。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON ボディが不正です。" }, { status: 400 });
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const reportType = b.reportType;
  if (reportType !== "prevention" && reportType !== "photo") {
    return Response.json({ error: "reportType は 'prevention' | 'photo'。" }, { status: 400 });
  }
  if (reportType === "photo") {
    return Response.json(
      { error: "写真報告書の確定（写真凍結）は未実装です（1c 配線時に対応）。" },
      { status: 501 }
    );
  }

  const stage = typeof b.stage === "string" ? b.stage : undefined;
  const title = typeof b.title === "string" ? b.title : undefined;
  const customerVisible = b.customerVisible === true;

  // version 未指定なら最新版を確定。
  let version = Number(b.version);
  if (!Number.isInteger(version) || version < 1) {
    const versions = await listPreventionVersions(folderId);
    if (versions.length === 0) {
      return Response.json(
        { error: "確定できる版がありません（先に保存してください）。" },
        { status: 409 }
      );
    }
    version = versions[0].version; // 先頭＝最大版
  }

  try {
    const { deliverableId } = await registerDeliverable({
      caseId: auth.caseId,
      reportType: "prevention",
      folderId,
      version,
      stage,
      title,
      customerVisible,
      confirmedBy: iapUserEmail(request.headers)
    });
    return Response.json({ deliverableId, version, customerVisible });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "確定に失敗しました。" },
      { status: 500 }
    );
  }
}
