import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";

type ChemicalRow = {
  name: string;
  unit: string;
  methods: string[];
};

/**
 * 指定害虫に適用できる薬剤一覧（カスケード2段目）。
 * 各薬剤の処理方法(methods)も同梱し、3段目をクライアント側で即時に出せるようにする。
 * 例: /api/master/chemicals?pest=ネズミ
 */
export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json(
      { error: "Supabase未設定（.env.localにSUPABASE_URL/SERVICE_ROLE_KEYを設定）" },
      { status: 503 }
    );
  }
  const pest = new URL(request.url).searchParams.get("pest")?.trim();
  if (!pest) {
    return Response.json({ error: "pest パラメータが必要です。" }, { status: 400 });
  }
  try {
    const filter = `applicable_pests=cs.{${encodeURIComponent(pest)}}`;
    const rows = await sbSelect<ChemicalRow>(
      `chemicals?${filter}&select=name,unit,methods&order=name`
    );
    return Response.json({ chemicals: rows });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "取得に失敗しました。" },
      { status: 500 }
    );
  }
}
