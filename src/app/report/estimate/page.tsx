import { loadSettingsForDate } from "@/lib/estimate-settings-store";
import { listPriceBook } from "@/lib/price-book-store";
import type { PriceBookItem } from "@/schemas/price-book";
import { EstimateEditor } from "@/components/estimate-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 見積作成（リング2・編集面の試作）。社内専用（IAP）。
 *
 * 計算式設定（見積日に有効な版）と販売価格表を読み、明細の物理量から原価積算して
 * ライブ計算＋粗利を見せる。計算は純粋エンジン（estimate-calc.ts）をクライアントでも実行。
 * 保存（版管理・Drive）／A4 PDF は後続スライス（③④）。
 * 仕様: docs/spec/ring2-estimate.md（着手時）/ vision/case-portal.md §9
 */
export default async function EstimateNewPage() {
  const today = new Date().toISOString().slice(0, 10);
  const settings = await loadSettingsForDate(today);
  let products: PriceBookItem[] = [];
  let masterError: string | null = null;
  try {
    products = await listPriceBook();
  } catch (e) {
    masterError = e instanceof Error ? e.message : "販売価格表の取得に失敗しました。";
  }

  return (
    <main>
      <section className="panel">
        <h1>見積作成（リング2・試作）</h1>
        <p className="notice">
          明細ごとに薬剤を販売価格表から選び、数量を入れると<strong>原価積算→標準価格→粗利</strong>を
          その場で計算します。単価・各率は<strong>{today} 時点の計算式設定</strong>（管理画面で版管理）。
          保存・A4 PDF は次のスライスで追加します。
        </p>
        {masterError ? (
          <p className="notice">
            販売価格表が読めません（{masterError}）。Supabase へのマイグレーション適用と
            <code>import-price-book.mjs</code> 取り込みを確認してください。
          </p>
        ) : null}
        <EstimateEditor settings={settings} products={products} today={today} />
      </section>
    </main>
  );
}
