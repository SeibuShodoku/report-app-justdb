import { driveConfigured, driveListImages } from "@/lib/drive";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

// node:crypto / ストリームを使うため Node ランタイム固定。
export const runtime = "nodejs";

/**
 * Drive フォルダ直下の画像を一覧する（画像プロキシ §7）。
 * 例: /api/folder?folderId=FID&token=...   または x-proxy-secret ヘッダ（VM）
 */
export async function GET(request: Request) {
  if (!driveConfigured()) {
    return Response.json(
      { error: "Drive未設定（.env に GOOGLE_SA_KEY_JSON を設定）" },
      { status: 503 }
    );
  }
  const folderId = new URL(request.url).searchParams.get("folderId")?.trim();
  if (!folderId) {
    return Response.json({ error: "folderId が必要です。" }, { status: 400 });
  }

  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const images = await driveListImages(folderId);
    return Response.json({ folderId, count: images.length, images });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "一覧取得に失敗しました。" },
      { status: 500 }
    );
  }
}
