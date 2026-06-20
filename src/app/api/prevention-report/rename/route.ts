import { driveWriteConfigured } from "@/lib/drive-write";
import { renameReportVersion } from "@/lib/prevention-report-store";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

export const runtime = "nodejs";

/**
 * 版に名前（ラベル）を付ける/変更する＝Drive description のみ更新（報告本文は不変）。
 * 例: POST /api/prevention-report/rename?folderId=DIR&token=...  body={ version: 2, label: "顧客確認用" }
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
    return Response.json({ error: "版名の編集は人の操作に限ります。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON ボディが不正です。" }, { status: 400 });
  }
  const version = Number((body as { version?: unknown })?.version);
  const label = (body as { label?: unknown })?.label;
  if (!Number.isInteger(version) || version < 1) {
    return Response.json({ error: "version（正の整数）が必要です。" }, { status: 400 });
  }
  if (typeof label !== "string") {
    return Response.json({ error: "label（文字列）が必要です。" }, { status: 400 });
  }

  try {
    await renameReportVersion(folderId, version, label);
    return Response.json({ version, label: label.trim().slice(0, 200) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "版名の更新に失敗しました。" },
      { status: 500 }
    );
  }
}
