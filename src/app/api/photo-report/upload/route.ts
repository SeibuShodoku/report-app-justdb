import { driveWriteConfigured, uploadImageFile } from "@/lib/drive-write";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

// Drive 書込み（RW）を行うため Node ランタイム固定。
export const runtime = "nodejs";

const MAX_FILES = 30; // 1リクエストの上限枚数（クライアントは原則1枚ずつ送る＝Cloud Run 32MB制限回避）
const MAX_BYTES = 25 * 1024 * 1024; // 1枚の上限（25MB・Cloud Runの32MB未満に収める）
const ALLOWED = /^image\//; // 画像MIME（HEIC含む image/* を許容）
const IMG_EXT = /\.(jpe?g|png|heic|heif|webp|gif|bmp|tiff?)$/i; // iOS等で type が空のときの救済

/** File の MIME を決める。type が image/* ならそれ、無ければ拡張子から補完（既定 image/jpeg）。 */
function mimeFor(file: File): string {
  if (ALLOWED.test(file.type)) return file.type;
  const ext = (file.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic",
    heif: "image/heif", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", tif: "image/tiff", tiff: "image/tiff"
  };
  return map[ext] ?? "image/jpeg";
}

/**
 * 現場写真を WEB からその日の写真フォルダ（folderId）へ直接アップロードする（案件ポータル動線・フェーズ1）。
 * - 認可: 起動トークン（folderId 一致）＝ブラウザのみ。IAP が「誰か」を担保。
 * - multipart/form-data の `file`（複数可）を Drive へ直書き。Supabase/版は触らない（写真の実体だけ追加）。
 * 例: POST /api/photo-report/upload?folderId=DIR&token=...
 */
export async function POST(request: Request) {
  if (!driveWriteConfigured()) {
    return Response.json(
      { error: "Drive書込未設定（GOOGLE_CLIENT_ID/SECRET と (RW or) DRIVE_REFRESH_TOKEN）" },
      { status: 503 }
    );
  }

  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId")?.trim();
  if (!folderId) return Response.json({ error: "folderId が必要です。" }, { status: 400 });

  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.mode !== "browser") {
    return Response.json({ error: "アップロードは人の操作に限ります（起動トークンが必要）。" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "フォームデータが不正です。" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "写真が選ばれていません。" }, { status: 400 });
  if (files.length > MAX_FILES) {
    return Response.json({ error: `一度に送れるのは${MAX_FILES}枚までです。` }, { status: 400 });
  }

  const uploaded: Array<{ id: string; name: string }> = [];
  try {
    for (const file of files) {
      if (!ALLOWED.test(file.type) && !IMG_EXT.test(file.name)) {
        return Response.json({ error: `画像以外は受け付けません（${file.name}）。` }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return Response.json(
          { error: `1枚あたり${Math.floor(MAX_BYTES / 1024 / 1024)}MBまでです（${file.name}）。` },
          { status: 400 }
        );
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const name = (file.name || `photo-${Date.now()}.jpg`).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
      uploaded.push(await uploadImageFile(folderId, name, mimeFor(file), buf));
    }
  } catch (error) {
    // 途中まで成功している場合もあるので、成功分を返しつつエラーを伝える。
    return Response.json(
      {
        error: error instanceof Error ? error.message : "アップロードに失敗しました。",
        uploaded
      },
      { status: 502 }
    );
  }

  return Response.json({ ok: true, count: uploaded.length, uploaded });
}
