import { deleteReportVersion } from "@/lib/photo-report-store";
import { driveWriteConfigured } from "@/lib/drive-write";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

export const runtime = "nodejs";

/**
 * 版を削除する＝Drive ゴミ箱へ（復元可・物理削除しない）。**最新版は削除不可**。
 * 例: POST /api/photo-report/delete?folderId=DIR&token=...  body={ version: 2 }
 */
export async function POST(request: Request) {
  if (!driveWriteConfigured()) {
    return Response.json({ error: "Drive書込未設定。" }, { status: 503 });
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
    return Response.json({ error: "版の削除は人の操作に限ります。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON ボディが不正です。" }, { status: 400 });
  }
  const version = Number((body as { version?: unknown })?.version);
  if (!Number.isInteger(version) || version < 1) {
    return Response.json({ error: "version（正の整数）が必要です。" }, { status: 400 });
  }

  try {
    await deleteReportVersion(folderId, version);
    return Response.json({ version, trashed: true });
  } catch (error) {
    // 最新版削除など運用上の拒否は 409 で返す（500 と区別）。
    const msg = error instanceof Error ? error.message : "版の削除に失敗しました。";
    const status = msg.includes("最新版は削除できません") ? 409 : 500;
    return Response.json({ error: msg }, { status });
  }
}
