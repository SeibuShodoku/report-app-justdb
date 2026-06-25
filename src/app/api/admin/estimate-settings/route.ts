/**
 * 見積 計算式設定の API（社内専用・IAP 配下）。
 * - GET  : 版一覧
 * - POST : 版を作成（＝値上げ改定）
 * 認可は IAP（@seibu-s.co.jp SSO）。作成者は IAP メールを記録。
 * 仕様: docs/spec/estimate/ring2-estimate.md（着手時）
 */
import { createSettingsVersion, listSettingsVersions } from "@/lib/estimate-settings-store";
import { estimateSettingsVersionInputSchema } from "@/schemas/estimate-settings";
import { iapUserEmail } from "@/lib/security/iap-user";
import { supabaseConfigured } from "@/lib/supabase-rest";

export const runtime = "nodejs";

export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase未設定です。" }, { status: 503 });
  }
  try {
    const versions = await listSettingsVersions();
    return Response.json({ versions });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "取得に失敗しました。" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase未設定です。" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON が不正です。" }, { status: 400 });
  }
  const parsed = estimateSettingsVersionInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "入力が不正です。", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  try {
    const created = await createSettingsVersion(parsed.data, iapUserEmail(request.headers));
    return Response.json({ version: created }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "作成に失敗しました。";
    // 識別キー重複（unique 制約）は 409 で返す。
    const status = /duplicate|conflict|unique/i.test(msg) ? 409 : 500;
    return Response.json({ error: msg }, { status });
  }
}
