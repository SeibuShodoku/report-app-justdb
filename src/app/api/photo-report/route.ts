import { driveConfigured } from "@/lib/drive";
import { loadPhotoReportView } from "@/lib/photo-report-source";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

// node:crypto を使うため Node ランタイム固定。
export const runtime = "nodejs";

/**
 * 写真報告書のプリフィル用 report JSON を返す（VM ワーカー／クライアント再取得向け）。
 * 当面はフォルダの画像から素の下書きを合成（見出し・注記なし）。Phase 2 で AI 生成 JSON を載せる。
 * 例: /api/photo-report?folderId=DIR&caseId=CASE&token=...   または x-proxy-secret（VM）
 */
export async function GET(request: Request) {
  if (!driveConfigured()) {
    return Response.json(
      { error: "Drive未設定（.env に GOOGLE_CLIENT_ID/SECRET/GOOGLE_DRIVE_REFRESH_TOKEN を設定）" },
      { status: 503 }
    );
  }
  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId")?.trim();
  const caseId = params.get("caseId")?.trim();
  if (!folderId) {
    return Response.json({ error: "folderId が必要です。" }, { status: 400 });
  }

  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  // ブラウザ経路では token の caseId を採用（URL の caseId と食い違わせない）。
  const effectiveCaseId =
    auth.mode === "browser" ? auth.caseId : caseId ?? "";

  try {
    const view = await loadPhotoReportView(effectiveCaseId, folderId);
    return Response.json(view);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "下書き生成に失敗しました。" },
      { status: 500 }
    );
  }
}
