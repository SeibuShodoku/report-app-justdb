import { getGenerationStatus, getReportSummary, requestGeneration } from "@/lib/photo-report-store";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";
import { supabaseConfigured } from "@/lib/supabase-rest";

export const runtime = "nodejs";

/** 生成ジョブの状態を返す（クライアントの完了ポーリング用）。例: GET ?folderId&token */
export async function GET(request: Request) {
  if (!supabaseConfigured()) return Response.json({ error: "Supabase未設定。" }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId")?.trim();
  if (!folderId) return Response.json({ error: "folderId が必要です。" }, { status: 400 });
  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  try {
    const st = await getGenerationStatus(folderId);
    // まとめだけAI生成の完了反映用に、done なら概要・内容も返す（クライアントは全体再読込せず反映）。
    if (st.status === "done") {
      const summary = await getReportSummary(folderId);
      return Response.json({ ...st, ...summary });
    }
    return Response.json(st);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "状態取得に失敗しました。" },
      { status: 500 }
    );
  }
}

/**
 * WEB から AI 生成（再生成）を依頼する＝`photo_report_jobs` を投入/再投入。VM ワーカーが拾い、
 * 保存済み設定をプロンプトへ反映して report を生成する（現在版を上書き）。ブラウザ（起動トークン）のみ。
 * 例: POST /api/photo-report/generate?folderId=DIR&token=...
 */
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
    return Response.json({ error: "生成依頼は人の操作に限ります。" }, { status: 403 });
  }

  // mode=summary＝写真を読まず「概要・内容」だけを見出しから生成（軽量）。既定は full。
  const genMode = params.get("mode") === "summary" ? "summary" : "full";

  try {
    const r = await requestGeneration(folderId, auth.caseId, genMode);
    return Response.json({ ok: true, mode: genMode, ...r });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "生成依頼に失敗しました。" },
      { status: 500 }
    );
  }
}
