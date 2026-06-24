/**
 * 販売価格表（薬剤資材マスタ）の取得 API（社内・IAP 配下）。
 * - `?categories=1` : 中分類の一覧
 * - `?category=ゴキブリ` : そのカテゴリの品目
 * - パラメータ無し : 全有効品目
 * 見積エディタが薬剤を選ぶために引く。仕様: ring2-estimate
 */
import { listPriceBook, listPriceBookCategories } from "@/lib/price-book-store";
import { supabaseConfigured } from "@/lib/supabase-rest";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!supabaseConfigured()) {
    return Response.json({ error: "Supabase未設定です。" }, { status: 503 });
  }
  const params = new URL(request.url).searchParams;
  try {
    if (params.get("categories") === "1") {
      return Response.json({ categories: await listPriceBookCategories() });
    }
    const category = params.get("category") ?? undefined;
    return Response.json({ items: await listPriceBook(category) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "取得に失敗しました。" },
      { status: 500 }
    );
  }
}
