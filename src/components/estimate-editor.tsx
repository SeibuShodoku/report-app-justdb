"use client";

/**
 * 見積エディタ（クライアント島・リング2 試作）。
 *
 * 構造：見積（表紙）→ 明細（施工内容・労務・移動・坪・回数）→ 明細内の薬剤明細（縦持ち・複数）。
 * 物理量を入れると純粋エンジン（estimate-calc.ts）で原価積算→標準価格→粗利をライブ計算する。
 * 薬剤は販売価格表（props）から選び、売価単価・販売掛率・単位を取り込む（1明細に複数可）。
 * 計算式設定（単価・各率）は props（見積日に有効な版）。保存／版管理／A4 PDF は後続（③④）。
 * 認可はページが IAP 社内SSO 配下。仕様: docs/spec/ring2-estimate.md（着手時）
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
  laborHours: string; // 施工時間(h)
  workers: string; // 作業人数
  travelKm: string; // 移動距離
  count: string; // 作業回数
  hazardFactor: string; // 床下・高所・特殊作業係数
  reportFee: string; // 報告書作成費用
  tsubo: string; // 坪数（シロアリ）
  tsuboUnitPrice: string; // 見積坪単価（シロアリ・売価）
  termiteChemTsuboPrice: string; // 防蟻剤坪単価（シロアリ・薬剤から）
  termiteChemMarkup: string; // 防蟻剤の販売掛率
  costCoefficient: string; // 原価係数（選択）
  priceOverride: string; // 見積金額の手入力
  discount: string; // 値引額
  collapsed: boolean; // UI: 畳み状態
};

/** 業務タイプ（見積明細の分類。固定選択肢）。 */
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
    laborHours: "",
    workers: "1",
    travelKm: "",
    count: "1",
    hazardFactor: "1",
    reportFee: "",
    tsubo: "",
    tsuboUnitPrice: "",
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

function toInput(l: EditorLine): EstimateLineInput {
  return {
    mode: l.mode,
    costCoefficient: numOrUndef(l.costCoefficient) ?? 0,
    count: numOrUndef(l.count),
    chemicals: l.chemicals.map((c) => ({
      unitPrice: numOrUndef(c.unitPrice),
      qty: numOrUndef(c.qty),
      markup: numOrUndef(c.markup)
    })),
    laborHours: numOrUndef(l.laborHours),
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

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter((c): c is string => Boolean(c)))].sort(),
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
    if (!p) return;
    updateLine(lineId, {
      termiteChemTsuboPrice: String(p.saleUnitPrice),
      termiteChemMarkup: p.markup != null ? String(p.markup) : ""
    });
  }

  return (
    <div className="section-block">
      {/* 表紙（ヘッダ） */}
      <h2>表紙</h2>
      <div className="editor-field">
        <label>
          見積日
          <input type="date" value={estimateDate} onChange={(e) => setEstimateDate(e.target.value)} />
        </label>
      </div>
      <div className="editor-field">
        <label>
          顧客名
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="○○ 御中" />
        </label>
      </div>
      <div className="editor-field">
        <label>
          施工先名
          <input value={site} onChange={(e) => setSite(e.target.value)} />
        </label>
      </div>
      <div className="editor-field">
        <label>
          件名（見積内容）
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
      </div>

      {/* 明細 */}
      <h2>明細</h2>
      {lines.map((l, i) => {
        const r: CalculatedLine = calc.lines[i];
        const isTermite = l.mode === "termiteTsubo";
        return (
          <fieldset key={l.id} className="section-block">
            <legend>明細 {i + 1}</legend>

            <div className="inline-actions">
              <button type="button" className="btn-secondary" onClick={() => updateLine(l.id, { collapsed: !l.collapsed })}>
                {l.collapsed ? "▶ 開く" : "▼ 畳む"}
              </button>
              <span>
                業務タイプ：<strong>{l.workType.trim() || l.workContent || "（未入力）"}</strong>
              </span>
              <span>
                金額：<strong>{yen(r.amount)}</strong>
              </span>
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
              <>
                <div className="editor-field">
                  <label>
                    業務タイプ
                    <select value={l.workType} onChange={(e) => updateLine(l.id, { workType: e.target.value })}>
                      <option value="">（選択）</option>
                      {WORK_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="editor-field">
                  <label>
                    計算方式
                    <select value={l.mode} onChange={(e) => updateLine(l.id, { mode: e.target.value as EstimateCalcMode })}>
                      <option value="general">一般施工金額計算</option>
                      <option value="termiteTsubo">シロアリ坪単価計算</option>
                    </select>
                  </label>
                </div>

                <div className="editor-field">
                  <label>
                    施工内容
                    <input value={l.workContent} onChange={(e) => updateLine(l.id, { workContent: e.target.value })} />
                  </label>
                </div>

                {/* 薬剤明細（縦持ち・複数） */}
                <div className="section-block">
                  <strong>薬剤（複数可）</strong>
                  {l.chemicals.length === 0 ? (
                    <p className="notice">薬剤なし。必要なら「＋薬剤を追加」。</p>
                  ) : null}
                  {l.chemicals.map((c) => {
                    const opts = products.filter((p) => !c.category || p.category === c.category);
                    return (
                      <div key={c.id} className="editor-field">
                        <select value={c.category} onChange={(e) => updateChem(l.id, c.id, { category: e.target.value, priceTableId: "" })}>
                          <option value="">（中分類）</option>
                          {categories.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>{" "}
                        <select value={c.priceTableId} onChange={(e) => selectChemProduct(l.id, c.id, e.target.value)}>
                          <option value="">（薬剤を選択）</option>
                          {opts.map((p) => (
                            <option key={p.priceTableId} value={p.priceTableId}>
                              {p.productName}（{yen(p.saleUnitPrice)}/{p.unit ?? "単位"}）
                            </option>
                          ))}
                        </select>{" "}
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={c.qty}
                          onChange={(e) => updateChem(l.id, c.id, { qty: e.target.value })}
                          placeholder="使用量"
                          style={{ width: "6rem" }}
                        />{" "}
                        {c.unit ? <span>{c.unit}</span> : null}{" "}
                        <button type="button" className="btn-secondary" onClick={() => removeChem(l.id, c.id)}>
                          削除
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => addChem(l.id)}>
                    ＋薬剤を追加
                  </button>
                </div>

                {isTermite ? (
                  <>
                    <div className="editor-field">
                      <label>
                        坪数
                        <input type="number" min={0} step="any" value={l.tsubo} onChange={(e) => updateLine(l.id, { tsubo: e.target.value })} />
                      </label>
                    </div>
                    <div className="editor-field">
                      <label>
                        見積坪単価（売価/坪）
                        <input type="number" min={0} step="any" value={l.tsuboUnitPrice} onChange={(e) => updateLine(l.id, { tsuboUnitPrice: e.target.value })} />
                      </label>
                    </div>
                    <div className="editor-field">
                      <label>
                        防蟻剤（シロアリ薬剤を選択→坪単価に反映）
                        <select value="" onChange={(e) => selectTermiteChem(l.id, e.target.value)}>
                          <option value="">（薬剤を選択）</option>
                          {products
                            .filter((p) => p.category === "シロアリ")
                            .map((p) => (
                              <option key={p.priceTableId} value={p.priceTableId}>
                                {p.productName}（{yen(p.saleUnitPrice)}/{p.unit ?? "単位"}）
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <div className="editor-field">
                      <label>
                        防蟻剤坪単価（売価/坪）
                        <input type="number" min={0} step="any" value={l.termiteChemTsuboPrice} onChange={(e) => updateLine(l.id, { termiteChemTsuboPrice: e.target.value })} />
                      </label>
                    </div>
                  </>
                ) : null}

                <div className="editor-field">
                  <label>
                    施工時間（時間）
                    <input type="number" min={0} step="any" value={l.laborHours} onChange={(e) => updateLine(l.id, { laborHours: e.target.value })} />
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    作業人数
                    <input type="number" min={0} step={1} value={l.workers} onChange={(e) => updateLine(l.id, { workers: e.target.value })} />
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    移動距離（km）
                    <input type="number" min={0} step="any" value={l.travelKm} onChange={(e) => updateLine(l.id, { travelKm: e.target.value })} />
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    作業回数
                    <input type="number" min={1} step={1} value={l.count} onChange={(e) => updateLine(l.id, { count: e.target.value })} />
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    床下・高所・特殊作業係数
                    <select value={l.hazardFactor} onChange={(e) => updateLine(l.id, { hazardFactor: e.target.value })}>
                      <option value="1">1（標準）</option>
                      <option value="0.1">0.1</option>
                    </select>
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    報告書作成費用
                    <input type="number" min={0} step="any" value={l.reportFee} onChange={(e) => updateLine(l.id, { reportFee: e.target.value })} />
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    原価係数
                    <select value={l.costCoefficient} onChange={(e) => updateLine(l.id, { costCoefficient: e.target.value })}>
                      {coOptions.map((c) => (
                        <option key={c} value={String(c)}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    見積金額（手入力・空欄なら標準価格 {yen(r.standardPrice)}）
                    <input type="number" min={0} step="any" value={l.priceOverride} onChange={(e) => updateLine(l.id, { priceOverride: e.target.value })} placeholder={String(r.standardPrice)} />
                  </label>
                </div>
                <div className="editor-field">
                  <label>
                    値引額
                    <input type="number" min={0} step="any" value={l.discount} onChange={(e) => updateLine(l.id, { discount: e.target.value })} />
                  </label>
                </div>

                {/* ライブ計算結果 */}
                <table className="version-list">
                  <tbody>
                    <tr><th>薬剤 売価 / 原価</th><td>{yen(r.chemicalSale)} / {yen(r.chemicalCost)}</td></tr>
                    <tr><th>施工コスト（原価）</th><td>{yen(r.constructionCost)}</td></tr>
                    <tr><th>標準価格</th><td>{yen(r.standardPrice)}</td></tr>
                    <tr><th>見積金額</th><td>{yen(r.amount)}</td></tr>
                    <tr><th>粗利額 / 粗利率</th><td>{yen(r.grossProfit)} / {pct(r.grossMarginRate)}</td></tr>
                  </tbody>
                </table>
              </>
            )}
          </fieldset>
        );
      })}

      <div className="inline-actions">
        <button type="button" onClick={() => setLines((prev) => [...prev, newLine({ costCoefficient: coOptions[0] })])}>
          ＋ 明細を追加
        </button>
      </div>

      {/* 合計 */}
      <h2>合計</h2>
      <table className="version-list">
        <tbody>
          <tr><th>見積本体価格</th><td>{yen(calc.subtotal)}</td></tr>
          <tr><th>消費税（{pct(settings.taxRate)}）</th><td>{yen(calc.tax)}</td></tr>
          <tr><th>税込見積金額</th><td><strong>{yen(calc.total)}</strong></td></tr>
          <tr><th>粗利額 / 粗利率（全体）</th><td>{yen(calc.grossProfitTotal)} / {pct(calc.grossMarginRate)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
