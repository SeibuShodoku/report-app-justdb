import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";

/** 害虫マスタ一覧（カスケード1段目）。 */
export async function GET() {
  if (!supabaseConfigured()) {
    return Response.json(
      { error: "Supabase未設定（.env.localにSUPABASE_URL/SERVICE_ROLE_KEYを設定）" },
      { status: 503 }
    );
  }
  try {
    const rows = await sbSelect<{ name: string }>("pests?select=name&order=name");
    return Response.json({ pests: rows.map((r) => r.name) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "取得に失敗しました。" },
      { status: 500 }
    );
  }
}
