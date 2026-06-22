import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";

type ChemicalRow = {
  name: string;
  unit: string;
  methods: string[];
};

/**
 * 薬剤一覧（カスケード2段目）。各薬剤の処理方法(methods)を同梱し3段目を即時に出せるようにする。
 * - `?pest=ネズミ`：その害虫に適用できる薬剤（従来・モック互換）。
 * - パラメータ無し：**全薬剤を applicablePests 付きで返す**（編集画面が初期化で一括キャッシュし、
 *   害虫選択時にローカルで即時フィルタ＝都度フェッチの待ちを無くす）。
 */
export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json(
      { error: "Supabase未設定（.env.localにSUPABASE_URL/SERVICE_ROLE_KEYを設定）" },
      { status: 503 }
    );
  }
  const pest = new URL(request.url).searchParams.get("pest")?.trim();
  try {
    if (!pest) {
      // 全件（初期化キャッシュ用）。applicable_pests を含め、クライアントで害虫→薬剤を即時に引けるように。
      const rows = await sbSelect<ChemicalRow & { applicable_pests: string[] }>(
        `chemicals?select=name,unit,methods,applicable_pests&order=name`
      );
      return Response.json({
        chemicals: rows.map((r) => ({
          name: r.name,
          unit: r.unit,
          methods: r.methods ?? [],
          applicablePests: r.applicable_pests ?? []
        }))
      });
    }
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
