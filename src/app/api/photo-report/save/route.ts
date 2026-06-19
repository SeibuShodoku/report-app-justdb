import { driveWriteConfigured } from "@/lib/drive-write";
import { saveReportVersion } from "@/lib/photo-report-store";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";
import { supabaseConfigured } from "@/lib/supabase-rest";
import { photoReportDraftSchema } from "@/schemas/photo-report";

// Drive 書込み（RW）・node:crypto を使うため Node ランタイム固定。
export const runtime = "nodejs";

/**
 * 写真報告書を保存する（人の編集）。
 * - Drive `_ai/reports/<folder_id>/v{連番}.json` を append-only で1つ書き、Supabase 現在版を差替。
 * - 認可: 起動トークン（folderId 一致）＝ブラウザ。IAP が「誰か」を担保する。
 * 例: POST /api/photo-report/save?folderId=DIR&token=...  body=report JSON
 */
export async function POST(request: Request) {
  if (!driveWriteConfigured()) {
    return Response.json(
      { error: "Drive書込未設定（GOOGLE_CLIENT_ID/SECRET と (RW or) DRIVE_REFRESH_TOKEN）" },
      { status: 503 }
    );
  }
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase未設定（SUPABASE_URL / KEY）" }, { status: 503 });
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
    return Response.json({ error: "保存は人の編集に限ります（起動トークンが必要）。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON ボディが不正です。" }, { status: 400 });
  }

  // フォルダ/案件IDは認可済みの値を権威とする（ボディの値を信用しない）。
  const incoming = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const note = typeof incoming.note === "string" ? incoming.note : undefined;
  const folderName = typeof incoming.folderName === "string" ? incoming.folderName : undefined;

  const parsed = photoReportDraftSchema.safeParse({
    ...(incoming.report && typeof incoming.report === "object" ? incoming.report : incoming),
    caseId: auth.caseId,
    driveFolderId: folderId
  });
  if (!parsed.success) {
    return Response.json(
      { error: "report の検証に失敗しました。", issues: parsed.error.issues.slice(0, 10) },
      { status: 400 }
    );
  }

  try {
    const saved = await saveReportVersion({
      report: parsed.data,
      source: "human",
      note,
      folderName
    });
    return Response.json(saved);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "保存に失敗しました。" },
      { status: 500 }
    );
  }
}
