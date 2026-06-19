import { driveWriteConfigured } from "@/lib/drive-write";
import { listReportVersions } from "@/lib/photo-report-store";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

export const runtime = "nodejs";

/**
 * 版一覧を返す（新しい版が先頭）。版ディレクトリが無ければ空配列。
 * 例: GET /api/photo-report/versions?folderId=DIR&token=...
 */
export async function GET(request: Request) {
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

  try {
    const versions = await listReportVersions(folderId);
    return Response.json({ versions });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "版一覧の取得に失敗しました。" },
      { status: 500 }
    );
  }
}
