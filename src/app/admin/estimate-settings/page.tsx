import {
  listSettingsVersions,
  resolveSettingsForDate,
  type EstimateSettingsVersion
} from "@/lib/estimate-settings-store";
import { DEFAULT_ESTIMATE_SETTINGS } from "@/schemas/estimate-settings";
import { EstimateSettingsAdmin } from "@/components/estimate-settings-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 見積（リング2）の計算式設定 管理画面。社内専用（IAP＝@seibu-s.co.jp SSO）。
 *
 * 版（識別キー＝値上げ改定の前後）を一覧し、新しい改定版を作成する。
 * 見積エディタ／PDF（後続）は「見積日に有効な版」を引いて計算する＝定数はここが唯一の供給源。
 * 仕様: docs/spec/estimate/ring2-estimate.md（着手時）/ vision/case-portal.md §9
 */
export default async function EstimateSettingsAdminPage() {
  let versions: EstimateSettingsVersion[] = [];
  let error: string | null = null;
  try {
    versions = await listSettingsVersions();
  } catch (e) {
    error = e instanceof Error ? e.message : "設定の取得に失敗しました。";
  }
  const today = new Date().toISOString().slice(0, 10);
  const active = resolveSettingsForDate(versions, today);

  return (
    <main>
      <section className="panel">
        <h1>見積 計算式設定（リング2）</h1>
        <p className="notice">
          人件費単価・移動単価・各率・薬剤係数・消費税率を「版」で管理します。値上げ改定のたびに
          <strong>新しい版を作成</strong>し、見積は<strong>その見積日に有効な版</strong>で計算されます
          （＝過去見積の再現性を担保）。
        </p>
        {error ? <p className="notice">取得エラー：{error}</p> : null}
        <EstimateSettingsAdmin
          versions={versions}
          today={today}
          activeId={active?.id ?? null}
          fallback={DEFAULT_ESTIMATE_SETTINGS}
        />
      </section>
    </main>
  );
}
