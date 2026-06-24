"use client";

/**
 * 見積エディタ（クライアント島・リング2 試作）。
 *
 * 構造：見積（表紙）→ 明細（施工内容・労務・移動・坪・回数）→ 明細内の薬剤明細（縦持ち・複数）。
 * 物理量を入れると純粋エンジン（estimate-calc.ts）で原価積算→標準価格→粗利をライブ計算する。
 * 薬剤は販売価格表（props・表示順は sort_order=JUST.DB順）から選び、売価単価・販売掛率・単位を取り込む。
 * 選択は検索つきセレクト（SearchSelect）。計算式設定は props（見積日に有効な版）。
 * 保存／版管理／A4 PDF は後続（③④）。認可はページが IAP 社内SSO 配下。仕様: docs/spec/ring2-estimate.md（着手時）
 */
import { useMemo, useState } from "react";
import {
  calcEstimate,
  type CalculatedLine,
  type EstimateCalcMode,
  type EstimateLineInput,
  type EstimateSettings
} from "@/lib/estimate-calc";
import type { PriceBookItem } from "@/schemas/price-book";
import { SearchSelect, type SelectOption } from "@/components/search-select";

type Props = {
  settings: EstimateSettings;
  products: PriceBookItem[];
  today: string;
};

/** 明細内の薬剤1行（明細フィールド）。 */
type ChemSub = {
  id: string;
  category: string; // 中分類フィルタ
  priceTableId: string; // 選択薬剤
  unitPrice: string; // 売価単価（薬剤から）
  markup: string; // 販売掛率（薬剤から）
  unit: string; // 単位（薬剤から）
  qty: string; // 使用量
};

type EditorLine = {
  id: string;
  mode: EstimateCalcMode;
  workType: string; // 業務タイプ（畳んだ時の見出し）
  workContent: string; // 施工内容
  chemicals: ChemSub[]; // 薬剤明細（複数）
  chemCollapsed: boolean; // 薬剤セクションの畳み状態
  laborH: string; // 施工時間（時）
  laborM: string; // 施工時間（分）
  workers: string; // 作業人数
  travelKm: string; // 移動距離
  count: string; // 作業回数
  hazardFactor: string; // 床下・高所・特殊作業係数
  reportFee: string; // 報告書作成費用
  tsubo: string; // 坪数（シロアリ）
  tsuboUnitPrice: string; // 見積坪単価（シロアリ・売価）
  termiteChemId: string; // 選択中の防蟻剤（表示用）
  termiteChemTsuboPrice: string; // 防蟻剤坪単価（シロアリ・薬剤から）
  termiteChemMarkup: string; // 防蟻剤の販売掛率
  costCoefficient: string; // 原価係数（選択）
  priceOverride: string; // 見積金額の手入力
  discount: string; // 値引額
  collapsed: boolean; // 明細の畳み状態
};

/** 業務タイプ（見積明細の分類。固定選択肢＝この順で表示）。 */
const WORK_TYPES = [
  "PC管理契約",
  "ネズミ駆除",
  "ゴキブリ駆除",
  "シロアリ新築",
  "シロアリ既築",
  "その他害虫駆除",
  "小動物対策",
  "鳥／コウモリ対策",
  "衛生（消毒など）",
  "その他"
] as const;
const WORK_TYPE_OPTIONS: SelectOption[] = WORK_TYPES.map((t) => ({ value: t, label: t }));

const HOUR_OPTS = Array.from({ length: 13 }, (_, i) => i); // 0〜12時間
const MIN_OPTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function newChem(): ChemSub {
  return { id: crypto.randomUUID(), category: "", priceTableId: "", unitPrice: "", markup: "", unit: "", qty: "" };
}

function newLine(defaults: { costCoefficient: number }): EditorLine {
  return {
    id: crypto.randomUUID(),
    mode: "general",
    workType: "",
    workContent: "",
    chemicals: [],
    chemCollapsed: false,
    laborH: "0",
    laborM: "0",
    workers: "1",
    travelKm: "",
    count: "1",
    hazardFactor: "1",
    reportFee: "",
    tsubo: "",
    tsuboUnitPrice: "",
    termiteChemId: "",
    termiteChemTsuboPrice: "",
    termiteChemMarkup: "",
    costCoefficient: String(defaults.costCoefficient),
    priceOverride: "",
    discount: "",
    collapsed: false
  };
}

const numOrUndef = (s: string): number | undefined => {
  const v = Number(s);
  return s.trim() !== "" && Number.isFinite(v) ? v : undefined;
};

/** 薬剤明細の売価合計（表示用。round(単価×使用量)×回数 の和）。 */
function chemListTotal(l: EditorLine): number {
  const count = numOrUndef(l.count) ?? 1;
  return l.chemicals.reduce((s, c) => {
    const up = numOrUndef(c.unitPrice) ?? 0;
    const q = numOrUndef(c.qty) ?? 0;
    return s + Math.round(up * q) * count;
  }, 0);
}

function toInput(l: EditorLine): EstimateLineInput {
  const h = numOrUndef(l.laborH);
  const m = numOrUndef(l.laborM);
  return {
    mode: l.mode,
    costCoefficient: numOrUndef(l.costCoefficient) ?? 0,
    count: numOrUndef(l.count),
    chemicals: l.chemicals.map((c) => ({
      unitPrice: numOrUndef(c.unitPrice),
      qty: numOrUndef(c.qty),
      markup: numOrUndef(c.markup)
    })),
    laborHours: h != null || m != null ? (h ?? 0) + (m ?? 0) / 60 : undefined,
    workers: numOrUndef(l.workers),
    travelKm: numOrUndef(l.travelKm),
    hazardFactor: numOrUndef(l.hazardFactor),
    reportFee: numOrUndef(l.reportFee),
    tsubo: numOrUndef(l.tsubo),
    tsuboUnitPrice: numOrUndef(l.tsuboUnitPrice),
    termiteChemTsuboPrice: numOrUndef(l.termiteChemTsuboPrice),
    termiteChemMarkup: numOrUndef(l.termiteChemMarkup),
    priceOverride: numOrUndef(l.priceOverride),
    discount: numOrUndef(l.discount)
  };
}

export function EstimateEditor({ settings, products, today }: Props) {
  const coOptions =
    settings.costCoefficientOptions && settings.costCoefficientOptions.length > 0
      ? settings.costCoefficientOptions
      : [0.3, 0.55];

  const [estimateDate, setEstimateDate] = useState(today);
  const [customer, setCustomer] = useState("");
  const [site, setSite] = useState("");
  const [subject, setSubject] = useState("");
  const [lines, setLines] = useState<EditorLine[]>(() => [newLine({ costCoefficient: coOptions[0] })]);

  // 中分類は products の並び（sort_order）を保持（アルファベット順にしない）。
  const categoryOptions = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    const out: SelectOption[] = [];
    for (const p of products) {
      if (p.category && !seen.has(p.category)) {
        seen.add(p.category);
        out.push({ value: p.category, label: p.category });
      }
    }
    return out;
  }, [products]);

  const termiteOptions = useMemo<SelectOption[]>(
    () =>
      products
        .filter((p) => p.category === "シロアリ")
        .map((p) => ({ value: p.priceTableId, label: `${p.productName}（${yen(p.saleUnitPrice)}/${p.unit ?? "単位"}）` })),
    [products]
  );

  const calc = useMemo(() => calcEstimate(lines.map(toInput), settings), [lines, settings]);

  function updateLine(id: string, patch: Partial<EditorLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function updateChem(lineId: string, chemId: string, patch: Partial<ChemSub>) {
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? { ...l, chemicals: l.chemicals.map((c) => (c.id === chemId ? { ...c, ...patch } : c)) }
          : l
      )
    );
  }

  function addChem(lineId: string) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, chemicals: [...l.chemicals, newChem()] } : l)));
  }

  function removeChem(lineId: string, chemId: string) {
    setLines((prev) =>
      prev.map((l) => (l.id === lineId ? { ...l, chemicals: l.chemicals.filter((c) => c.id !== chemId) } : l))
    );
  }

  function selectChemProduct(lineId: string, chemId: string, priceTableId: string) {
    const p = products.find((x) => x.priceTableId === priceTableId);
    if (!p) {
      updateChem(lineId, chemId, { priceTableId: "", unitPrice: "", markup: "", unit: "" });
      return;
    }
    updateChem(lineId, chemId, {
      priceTableId,
      unitPrice: String(p.saleUnitPrice),
      markup: p.markup != null ? String(p.markup) : "",
      unit: p.unit ?? ""
    });
  }

  function selectTermiteChem(lineId: string, priceTableId: string) {
    const p = products.find((x) => x.priceTableId === priceTableId);
    if (!p) {
      updateLine(lineId, { termiteChemId: "", termiteChemTsuboPrice: "", termiteChemMarkup: "" });
      return;
    }
    updateLine(lineId, {
      termiteChemId: priceTableId,
      termiteChemTsuboPrice: String(p.saleUnitPrice),
      termiteChemMarkup: p.markup != null ? String(p.markup) : ""
    });
  }

  return (
    <div className="estimate-editor">
      {/* 表紙（ヘッダ） */}
      <section>
        <h2>表紙</h2>
        <div className="est-grid">
          <label className="est-field">
            <span className="est-label">見積日</span>
            <input type="date" value={estimateDate} onChange={(e) => setEstimateDate(e.target.value)} />
          </label>
          <label className="est-field">
            <span className="est-label">顧客名</span>
            <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="○○ 御中" />
          </label>
          <label className="est-field">
            <span className="est-label">施工先名</span>
            <input value={site} onChange={(e) => setSite(e.target.value)} />
          </label>
          <label className="est-field">
            <span className="est-label">件名（見積内容）</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>
      </section>

      {/* 明細 */}
      <section>
        <h2>明細</h2>
        <div style={{ display: "grid", gap: "14px", marginTop: "12px" }}>
          {lines.map((l, i) => {
            const r: CalculatedLine = calc.lines[i];
            const isTermite = l.mode === "termiteTsubo";
            return (
              <div key={l.id} className="est-line">
                <div className={l.collapsed ? "est-line-head collapsed" : "est-line-head"}>
                  <button type="button" className="btn-secondary" onClick={() => updateLine(l.id, { collapsed: !l.collapsed })}>
                    {l.collapsed ? "▶ 開く" : "▼ 畳む"}
                  </button>
                  <span className="est-no">明細 {i + 1}</span>
                  <span className="est-type">{l.workType.trim() || l.workContent || "未設定"}</span>
                  <span className="est-amount">{yen(r.amount)}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== l.id) : prev))}
                    disabled={lines.length <= 1}
                  >
                    削除
                  </button>
                </div>

                {!l.collapsed && (
                  <div className="est-line-body">
                    <div className="est-grid">
                      <div className="est-field">
                        <span className="est-label">業務タイプ</span>
                        <SearchSelect
                          value={l.workType}
                          options={WORK_TYPE_OPTIONS}
                          onChange={(v) => updateLine(l.id, { workType: v })}
                        />
                      </div>
                      <label className="est-field">
                        <span className="est-label">計算方式</span>
                        <select value={l.mode} onChange={(e) => updateLine(l.id, { mode: e.target.value as EstimateCalcMode })}>
                          <option value="general">一般施工金額計算</option>
                          <option value="termiteTsubo">シロアリ坪単価計算</option>
                        </select>
                      </label>
                      <label className="est-field">
                        <span className="est-label">施工内容</span>
                        <input value={l.workContent} onChange={(e) => updateLine(l.id, { workContent: e.target.value })} />
                      </label>
                    </div>

                    {/* 薬剤明細（縦持ち・複数・畳み可） */}
                    <div className="est-chems">
                      <div className="est-chems-head">
                        <span className="est-chems-title">薬剤（{l.chemicals.length}件）</span>
                        <span className="est-chems-total">売価合計 {yen(chemListTotal(l))}</span>
                        <button type="button" className="btn-secondary" onClick={() => updateLine(l.id, { chemCollapsed: !l.chemCollapsed })}>
                          {l.chemCollapsed ? "▶ 開く" : "▼ 畳む"}
                        </button>
                      </div>
                      {!l.chemCollapsed && (
                        <>
                          {l.chemicals.length === 0 ? <p className="notice">薬剤なし。必要なら「＋薬剤を追加」。</p> : null}
                          {l.chemicals.map((c) => {
                            const opts: SelectOption[] = products
                              .filter((p) => !c.category || p.category === c.category)
                              .map((p) => ({
                                value: p.priceTableId,
                                label: `${p.productName}（${yen(p.saleUnitPrice)}/${p.unit ?? "単位"}）`
                              }));
                            return (
                              <div key={c.id} className="est-chem-row">
                                <SearchSelect
                                  value={c.category}
                                  options={categoryOptions}
                                  placeholder="中分類"
                                  onChange={(v) => updateChem(l.id, c.id, { category: v, priceTableId: "" })}
                                />
                                <SearchSelect
                                  value={c.priceTableId}
                                  options={opts}
                                  placeholder="薬剤を検索／選択"
                                  onChange={(v) => selectChemProduct(l.id, c.id, v)}
                                />
                                <span className="est-qty">
                                  <input
                                    type="number"
                                    min={0}
                                    step="any"
                                    value={c.qty}
                                    onChange={(e) => updateChem(l.id, c.id, { qty: e.target.value })}
                                    placeholder="使用量"
                                  />
                                  {c.unit ? <span className="est-unit">{c.unit}</span> : null}
                                </span>
                                <button type="button" className="btn-secondary" onClick={() => removeChem(l.id, c.id)}>
                                  削除
                                </button>
                              </div>
                            );
                          })}
                          <div className="inline-actions">
                            <button type="button" onClick={() => addChem(l.id)}>
                              ＋薬剤を追加
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {isTermite ? (
                      <div className="est-grid">
                        <label className="est-field">
                          <span className="est-label">坪数</span>
                          <input type="number" min={0} step="any" value={l.tsubo} onChange={(e) => updateLine(l.id, { tsubo: e.target.value })} />
                        </label>
                        <label className="est-field">
                          <span className="est-label">見積坪単価（売価/坪）</span>
                          <input type="number" min={0} step="any" value={l.tsuboUnitPrice} onChange={(e) => updateLine(l.id, { tsuboUnitPrice: e.target.value })} />
                        </label>
                        <div className="est-field">
                          <span className="est-label">防蟻剤（薬剤選択→坪単価に反映）</span>
                          <SearchSelect
                            value={l.termiteChemId}
                            options={termiteOptions}
                            placeholder="防蟻剤を検索／選択"
                            onChange={(v) => selectTermiteChem(l.id, v)}
                          />
                        </div>
                        <label className="est-field">
                          <span className="est-label">防蟻剤坪単価（売価/坪）</span>
                          <input type="number" min={0} step="any" value={l.termiteChemTsuboPrice} onChange={(e) => updateLine(l.id, { termiteChemTsuboPrice: e.target.value })} />
                        </label>
                      </div>
                    ) : null}

                    <div className="est-grid">
                      <div className="est-field">
                        <span className="est-label">施工時間</span>
                        <div className="est-time">
                          <select value={l.laborH} onChange={(e) => updateLine(l.id, { laborH: e.target.value })}>
                            {HOUR_OPTS.map((h) => (
                              <option key={h} value={String(h)}>
                                {h}
                              </option>
                            ))}
                          </select>
                          <span>時間</span>
                          <select value={l.laborM} onChange={(e) => updateLine(l.id, { laborM: e.target.value })}>
                            {MIN_OPTS.map((m) => (
                              <option key={m} value={String(m)}>
                                {m}
                              </option>
                            ))}
                          </select>
                          <span>分</span>
                        </div>
                      </div>
                      <label className="est-field">
                        <span className="est-label">作業人数</span>
                        <input type="number" min={0} step={1} value={l.workers} onChange={(e) => updateLine(l.id, { workers: e.target.value })} />
                      </label>
                      <label className="est-field">
                        <span className="est-label">移動距離（km）</span>
                        <input type="number" min={0} step="any" value={l.travelKm} onChange={(e) => updateLine(l.id, { travelKm: e.target.value })} />
                      </label>
                      <label className="est-field">
                        <span className="est-label">作業回数</span>
                        <input type="number" min={1} step={1} value={l.count} onChange={(e) => updateLine(l.id, { count: e.target.value })} />
                      </label>
                      <label className="est-field">
                        <span className="est-label">床下・高所・特殊作業係数</span>
                        <select value={l.hazardFactor} onChange={(e) => updateLine(l.id, { hazardFactor: e.target.value })}>
                          <option value="1">1（標準）</option>
                          <option value="0.1">0.1</option>
                        </select>
                      </label>
                      <label className="est-field">
                        <span className="est-label">報告書作成費用</span>
                        <input type="number" min={0} step="any" value={l.reportFee} onChange={(e) => updateLine(l.id, { reportFee: e.target.value })} />
                      </label>
                      <label className="est-field">
                        <span className="est-label">原価係数</span>
                        <select value={l.costCoefficient} onChange={(e) => updateLine(l.id, { costCoefficient: e.target.value })}>
                          {coOptions.map((c) => (
                            <option key={c} value={String(c)}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="est-field">
                        <span className="est-label">見積金額（空欄＝標準価格 {yen(r.standardPrice)}）</span>
                        <input type="number" min={0} step="any" value={l.priceOverride} onChange={(e) => updateLine(l.id, { priceOverride: e.target.value })} placeholder={String(r.standardPrice)} />
                      </label>
                      <label className="est-field">
                        <span className="est-label">値引額</span>
                        <input type="number" min={0} step="any" value={l.discount} onChange={(e) => updateLine(l.id, { discount: e.target.value })} />
                      </label>
                    </div>

                    {/* ライブ計算結果 */}
                    <div className="est-result">
                      <div className="cell">
                        <span className="k">薬剤 売価/原価</span>
                        <span className="v">{yen(r.chemicalSale)} / {yen(r.chemicalCost)}</span>
                      </div>
                      <div className="cell">
                        <span className="k">施工コスト</span>
                        <span className="v">{yen(r.constructionCost)}</span>
                      </div>
                      <div className="cell">
                        <span className="k">標準価格</span>
                        <span className="v">{yen(r.standardPrice)}</span>
                      </div>
                      <div className="cell">
                        <span className="k">見積金額</span>
                        <span className="v">{yen(r.amount)}</span>
                      </div>
                      <div className="cell">
                        <span className="k">粗利額 / 粗利率</span>
                        <span className="v">{yen(r.grossProfit)} / {pct(r.grossMarginRate)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="inline-actions" style={{ marginTop: "12px" }}>
          <button type="button" onClick={() => setLines((prev) => [...prev, newLine({ costCoefficient: coOptions[0] })])}>
            ＋ 明細を追加
          </button>
        </div>
      </section>

      {/* 合計 */}
      <section>
        <h2>合計</h2>
        <div className="est-totals">
          <div className="cell">
            <span className="k">見積本体価格</span>
            <span className="v">{yen(calc.subtotal)}</span>
          </div>
          <div className="cell">
            <span className="k">消費税（{pct(settings.taxRate)}）</span>
            <span className="v">{yen(calc.tax)}</span>
          </div>
          <div className="cell">
            <span className="k">税込見積金額</span>
            <span className="v total">{yen(calc.total)}</span>
          </div>
          <div className="cell">
            <span className="k">粗利額 / 粗利率（全体）</span>
            <span className="v">{yen(calc.grossProfitTotal)} / {pct(calc.grossMarginRate)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
