import { loadSettings, saveSettings } from "@/lib/photo-report-settings-store";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";
import { supabaseConfigured } from "@/lib/supabase-rest";
import { photoReportSettingsSchema } from "@/schemas/photo-report-settings";

export const runtime = "nodejs";

/**
 * 写真報告書の生成設定（種類/実施日/物件名/担当者/トーン）。
 * GET = 現設定の取得（未設定は既定）。POST = upsert。いずれもブラウザ（起動トークン）認可。
 * 例: /api/photo-report/settings?folderId=DIR&token=...
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId")?.trim();
  if (!folderId) return Response.json({ error: "folderId が必要です。" }, { status: 400 });
  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const settings = await loadSettings(folderId);
  return Response.json({ settings });
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase未設定。" }, { status: 503 });
  }
  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId")?.trim();
  if (!folderId) return Response.json({ error: "folderId が必要です。" }, { status: 400 });
  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.mode !== "browser") {
    return Response.json({ error: "設定の保存は人の操作に限ります。" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON ボディが不正です。" }, { status: 400 });
  }
  const parsed = photoReportSettingsSchema.safeParse(
    (body as { settings?: unknown })?.settings ?? body
  );
  if (!parsed.success) {
    return Response.json(
      { error: "設定の検証に失敗しました。", issues: parsed.error.issues.slice(0, 10) },
      { status: 400 }
    );
  }

  try {
    await saveSettings(folderId, parsed.data);
    return Response.json({ ok: true, settings: parsed.data });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "設定の保存に失敗しました。" },
      { status: 500 }
    );
  }
}
