import { driveWriteConfigured } from "@/lib/drive-write";
import { rollbackToVersion } from "@/lib/photo-report-store";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";
import { supabaseConfigured } from "@/lib/supabase-rest";

export const runtime = "nodejs";

/**
 * 旧版へロールバック ＝ 旧版の内容で新版を1つ書く（過去版は不変・ロールバックも1版＝監査）。
 * 例: POST /api/photo-report/rollback?folderId=DIR&token=...  body={ version: 3 }
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
    return Response.json({ error: "ロールバックは人の操作に限ります。" }, { status: 403 });
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
    const saved = await rollbackToVersion({ folderId, caseId: auth.caseId, version });
    return Response.json(saved);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "ロールバックに失敗しました。" },
      { status: 500 }
    );
  }
}
