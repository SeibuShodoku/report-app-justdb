import { driveConfigured, driveGetFileMeta, driveGetMedia } from "@/lib/drive";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

// node:crypto / ストリームを使うため Node ランタイム固定。
export const runtime = "nodejs";

/**
 * Drive 上の画像実体をストリーム返却する（画像プロキシ §7）。
 * folderId も必須にし、ファイルが当該フォルダに属することを検証（フォルダ外 403）。
 * 例: /api/photo?fileId=FID&folderId=DIR&token=...   または x-proxy-secret ヘッダ（VM）
 */
export async function GET(request: Request) {
  if (!driveConfigured()) {
    return Response.json(
      { error: "Drive未設定（.env に GOOGLE_SA_KEY_JSON を設定）" },
      { status: 503 }
    );
  }
  const params = new URL(request.url).searchParams;
  const fileId = params.get("fileId")?.trim();
  const folderId = params.get("folderId")?.trim();
  if (!fileId || !folderId) {
    return Response.json({ error: "fileId と folderId が必要です。" }, { status: 400 });
  }

  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // フォルダ所属＆画像であることを検証してから実体を返す。
    const meta = await driveGetFileMeta(fileId);
    if (!meta.parents.includes(folderId)) {
      return Response.json(
        { error: "指定フォルダに属さないファイルです。" },
        { status: 403 }
      );
    }
    if (!meta.mimeType.startsWith("image/")) {
      return Response.json({ error: "画像ファイルではありません。" }, { status: 415 });
    }

    const media = await driveGetMedia(fileId);
    const headers = new Headers();
    headers.set("Content-Type", meta.mimeType);
    const len = media.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    headers.set("Cache-Control", "private, max-age=300");
    return new Response(media.body, { status: 200, headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "画像取得に失敗しました。" },
      { status: 500 }
    );
  }
}
