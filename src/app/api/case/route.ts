import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";

type ScheduleRow = {
  construction_id: string;
  case_id: string | null;
  order_id: string | null;
  customer_name: string | null;
  site: string | null;
  scheduled_at: string | null;
  report_date: string | null;
};

/**
 * 施工予定IDでケースデータを引く（顧客名・施工先・施工日時・報告日…）。
 * アンカー: 施工予定ID → 案件ID → 受注ID/見積書 と辿れる起点。
 * 例: /api/case?constructionId=CONST001
 */
export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json(
      { error: "Supabase未設定（.env.localにSUPABASE_URL/SERVICE_ROLE_KEYを設定）" },
      { status: 503 }
    );
  }
  const id = new URL(request.url).searchParams.get("constructionId")?.trim();
  if (!id) {
    return Response.json({ error: "constructionId が必要です。" }, { status: 400 });
  }
  try {
    const rows = await sbSelect<ScheduleRow>(
      `construction_schedules?construction_id=eq.${encodeURIComponent(id)}&select=*&limit=1`
    );
    if (rows.length === 0) {
      return Response.json({ error: `施工予定ID「${id}」が見つかりません。` }, { status: 404 });
    }
    return Response.json({ schedule: rows[0] });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "取得に失敗しました。" },
      { status: 500 }
    );
  }
}
