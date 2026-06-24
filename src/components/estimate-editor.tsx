"use client";

/**
 * 見積エディタ（クライアント島・リング2 試作）。
 *
 * 構造：見積（表紙）→ 明細（施工内容・労務・移動・坪・回数）→ 明細内の薬剤明細（縦持ち・複数）。
 * 物理量を入れると純粋エンジン（estimate-calc.ts）で原価積算→標準価格→粗利をライブ計算する。
 * 薬剤は販売価格表（props・表示順は sort_order=JUST.DB順）から検索つきセレクトで選び、単価/掛率/単位を取り込む。
 * 計算式設定は props（見積日に有効な版）。保存／版管理／A4 PDF は後続（③④）。
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
import { SearchSelect, type SelectOption } from "@/components/search-select";

type Props = {
  settings: EstimateSettings;
  products: PriceBookItem[];
  today: string;
};

/** 明細内の薬剤1行（明細フィールド）。 */
type ChemSub = {
  id: string;
  category: string;
  priceTableId: string;
  unitPrice: string;
  markup: string;
  unit: string;
  qty: string;
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
  laborSurcharge: string; // 割増料金係数（施工人件費に効く）
  travelKm: string; // 移動距離
  count: string; // 作業回数
  hazardFactor: string; // 床下・高所・特殊作業係数
  reportFee: string; // 報告書作成費用（固定選択）
  tsubo: string; // 坪数（シロアリ）
  tsuboUnitPrice: string; // 見積坪単価（シロアリ・売価）
  termitePlan: string; // 選択中の坪単価プラン（TERMITE_PLANS の index）
  termiteChemName: string; // 防蟻剤名（プランから・表示用）
  termiteChemTsuboPrice: string; // 防蟻剤坪単価（売価/坪）
  termiteChemMarkup: string; // 防蟻剤の販売掛率
  costCoefficient: string; // 原価係数（選択）
  priceOverride: string; // 見積金額の手入力（数字のみ保持）
  discount: string; // 値引額（数字のみ保持）
  collapsed: boolean; // 明細の畳み状態
  statusOpen: boolean; // 計算ステータス表示
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
// シロアリ坪単価計算のときだけ業務タイプを「シロアリ新築／既築」に絞る（一般ではこの2つを除外）。
const TERMITE_WORK_TYPES: string[] = ["シロアリ新築", "シロアリ既築"];
const GENERAL_WORK_TYPES: string[] = WORK_TYPES.filter((t) => !TERMITE_WORK_TYPES.includes(t));
const GENERAL_WORK_TYPE_OPTIONS: SelectOption[] = GENERAL_WORK_TYPES.map((t) => ({ value: t, label: t }));
const TERMITE_WORK_TYPE_OPTIONS: SelectOption[] = TERMITE_WORK_TYPES.map((t) => ({ value: t, label: t }));

/** 報告書作成費用（固定。金額＝作成時間の目安）。 */
const REPORT_FEE_OPTIONS = [
  { v: "0", label: "報告書なし・複写式" },
  { v: "1000", label: "作成15分" },
  { v: "2000", label: "作成30分" },
  { v: "3000", label: "作成45分" },
  { v: "4000", label: "作成60分" },
  { v: "6000", label: "作成90分" },
  { v: "8000", label: "作成120分" }
];

/** 割増料金係数（施工人件費に効く）。 */
const SURCHARGE_OPTIONS = [
  { v: "1", label: "割増なし" },
  { v: "1.25", label: "夜間・休日昼間" },
  { v: "1.5", label: "深夜" }
];

/** シロアリ防蟻剤：売価/坪 → 薬剤名。原価は 売価 ÷ 掛率(1.6)。 */
const TERMITE_CHEMS: Record<string, string> = {
  "1611": "エディクラ",
  "1768": "オプティガード",
  "1989": "タケロック",
  "3162": "天然ピレトリンMC"
};
const TERMITE_CHEM_MARKUP = "1.6";
/** 施工プラン：見積坪単価（坪数に掛ける金額）× 施工種別 → 紐づく防蟻剤売価。 */
const TERMITE_PLANS: { tsuboPrice: number; type: string; chemSale: number }[] = [
  { tsuboPrice: 8000, type: "木部＋土壌", chemSale: 1611 },
  { tsuboPrice: 2400, type: "新築木部のみ", chemSale: 1611 },
  { tsuboPrice: 3400, type: "新築土壌込", chemSale: 1611 },
  { tsuboPrice: 8240, type: "木部＋土壌", chemSale: 1768 },
  { tsuboPrice: 2500, type: "新築木部のみ", chemSale: 1768 },
  { tsuboPrice: 3500, type: "新築土壌込", chemSale: 1768 },
  { tsuboPrice: 8800, type: "木部＋土壌", chemSale: 1989 },
  { tsuboPrice: 3000, type: "新築木部のみ", chemSale: 1989 },
  { tsuboPrice: 4000, type: "新築土壌込", chemSale: 1989 },
  { tsuboPrice: 11000, type: "木部＋土壌", chemSale: 3162 },
  { tsuboPrice: 3600, type: "新築木部のみ", chemSale: 3162 },
  { tsuboPrice: 4600, type: "新築土壌込", chemSale: 3162 }
];

const HOUR_OPTS = Array.from({ length: 13 }, (_, i) => i); // 0〜12時間
const MIN_OPTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const stripDigits = (s: string) => s.replace(/[^\d]/g, "");
const withCommas = (s: string) => {
  const d = s.replace(/[^\d]/g, "");
  return d === "" ? "" : Number(d).toLocaleString();
};

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
    laborSurcharge: "1",
    travelKm: "",
    count: "1",
    hazardFactor: "0.1",
    reportFee: "0",
    tsubo: "",
    tsuboUnitPrice: "",
    termitePlan: "",
    termiteChemName: "",
    termiteChemTsuboPrice: "",
    termiteChemMarkup: "",
    costCoefficient: String(defaults.costCoefficient),
    priceOverride: "",
    discount: "",
    collapsed: false,
    statusOpen: true
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

/** 薬剤売価_集計（回数前。Σ round(単価×使用量)）。 */
function chemListSubtotal(l: EditorLine): number {
  return l.chemicals.reduce((s, c) => {
    const up = numOrUndef(c.unitPrice) ?? 0;
    const q = numOrUndef(c.qty) ?? 0;
    return s + Math.round(up * q);
  }, 0);
}

/** 施工時間変換（時間→2桁丸め）。 */
function laborHoursOf(l: EditorLine): number {
  const h = (numOrUndef(l.laborH) ?? 0) + (numOrUndef(l.laborM) ?? 0) / 60;
  return Math.round(h * 100) / 100;
}

/** ステータスの1セル。hint があれば ⓘ をタップで説明を開閉。 */
function HintCell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cell">
      <span className="k">
        {label}
        {hint ? (
          <button type="button" className="hint-btn" aria-label="説明" onClick={() => setOpen((o) => !o)}>
            ⓘ
          </button>
        ) : null}
      </span>
      <span className="v">{value}</span>
      {hint && open ? <span className="hint-text">{hint}</span> : null}
    </div>
  );
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
    laborSurcharge: numOrUndef(l.laborSurcharge),
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

  function selectTermitePlan(lineId: string, idxStr: string) {
    const p = TERMITE_PLANS[Number(idxStr)];
    if (!p) {
      updateLine(lineId, { termitePlan: "", termiteChemName: "" });
      return;
    }
    updateLine(lineId, {
      termitePlan: idxStr,
      tsuboUnitPrice: String(p.tsuboPrice),
      termiteChemName: TERMITE_CHEMS[String(p.chemSale)] ?? "",
      termiteChemTsuboPrice: String(p.chemSale),
      termiteChemMarkup: TERMITE_CHEM_MARKUP
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
            const workTypeOptions = isTermite ? TERMITE_WORK_TYPE_OPTIONS : GENERAL_WORK_TYPE_OPTIONS;
            // 業務タイプ（新築/既築）で坪単価プランを絞る。新築=新築木部のみ/新築土壌込、既築=木部＋土壌。
            const termitePlanEntries = TERMITE_PLANS.map((p, idx) => ({ p, idx })).filter(({ p }) =>
              l.workType === "シロアリ既築"
                ? !p.type.startsWith("新築")
                : l.workType === "シロアリ新築"
                  ? p.type.startsWith("新築")
                  : true
            );
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
                    <div className="est-row-2">
                      <label className="est-field">
                        <span className="est-label">計算方式</span>
                        <select
                          value={l.mode}
                          onChange={(e) => {
                            const mode = e.target.value as EstimateCalcMode;
                            const allowed = mode === "termiteTsubo" ? TERMITE_WORK_TYPES : GENERAL_WORK_TYPES;
                            const patch: Partial<EditorLine> = { mode };
                            if (l.workType && !allowed.includes(l.workType)) patch.workType = ""; // 新方式に無い業務タイプはクリア
                            updateLine(l.id, patch);
                          }}
                        >
                          <option value="general">一般施工金額計算</option>
                          <option value="termiteTsubo">シロアリ坪単価計算</option>
                        </select>
                      </label>
                      <div className="est-field">
                        <span className="est-label">業務タイプ</span>
                        <SearchSelect
                          value={l.workType}
                          options={workTypeOptions}
                          onChange={(v) => {
                            const patch: Partial<EditorLine> = { workType: v };
                            // シロアリ：業務タイプ(新築/既築)に合わない坪単価プランはクリア
                            if (l.mode === "termiteTsubo") {
                              const p = TERMITE_PLANS[Number(l.termitePlan)];
                              const ok =
                                !!p &&
                                (v === "シロアリ新築" ? p.type.startsWith("新築") : v === "シロアリ既築" ? !p.type.startsWith("新築") : true);
                              if (!ok) {
                                patch.termitePlan = "";
                                patch.termiteChemName = "";
                              }
                            }
                            updateLine(l.id, patch);
                          }}
                        />
                      </div>
                    </div>

                    <label className="est-field">
                      <span className="est-label">施工内容</span>
                      <input value={l.workContent} onChange={(e) => updateLine(l.id, { workContent: e.target.value })} />
                    </label>

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
                                <SearchSelect value={c.category} options={categoryOptions} placeholder="中分類" onChange={(v) => updateChem(l.id, c.id, { category: v, priceTableId: "" })} />
                                <SearchSelect value={c.priceTableId} options={opts} placeholder="薬剤を検索／選択" onChange={(v) => selectChemProduct(l.id, c.id, v)} />
                                <span className="est-qty">
                                  <input type="number" min={0} step="any" value={c.qty} onChange={(e) => updateChem(l.id, c.id, { qty: e.target.value })} placeholder="使用量" />
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
                      <>
                        <div className="est-row-2">
                          <label className="est-field">
                            <span className="est-label">坪数</span>
                            <input type="number" min={0} step="any" value={l.tsubo} onChange={(e) => updateLine(l.id, { tsubo: e.target.value })} />
                          </label>
                          <label className="est-field">
                            <span className="est-label">施工プラン（坪単価）</span>
                            <select value={l.termitePlan} onChange={(e) => selectTermitePlan(l.id, e.target.value)}>
                              <option value="">（プランを選択）</option>
                              {termitePlanEntries.map(({ p, idx }) => (
                                <option key={idx} value={String(idx)}>
                                  {p.type}　¥{p.tsuboPrice.toLocaleString()}/坪（{TERMITE_CHEMS[String(p.chemSale)]}）
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="est-row-3">
                          <label className="est-field">
                            <span className="est-label">見積坪単価（売価/坪）</span>
                            <input type="number" min={0} step="any" value={l.tsuboUnitPrice} onChange={(e) => updateLine(l.id, { tsuboUnitPrice: e.target.value })} />
                          </label>
                          <div className="est-field">
                            <span className="est-label">防蟻剤（プランで自動）</span>
                            <input value={l.termiteChemName} readOnly placeholder="プランを選択" />
                          </div>
                          <label className="est-field">
                            <span className="est-label">防蟻剤坪単価（売価/坪）</span>
                            <input type="number" min={0} step="any" value={l.termiteChemTsuboPrice} onChange={(e) => updateLine(l.id, { termiteChemTsuboPrice: e.target.value })} />
                          </label>
                        </div>
                      </>
                    ) : null}

                    <div className="est-row-2">
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
                        <span className="est-label">移動距離（km）</span>
                        <input type="number" min={0} step="any" value={l.travelKm} onChange={(e) => updateLine(l.id, { travelKm: e.target.value })} />
                      </label>
                    </div>

                    <div className="est-row-3">
                      <label className="est-field">
                        <span className="est-label">作業人数</span>
                        <input type="number" min={0} step={1} value={l.workers} onChange={(e) => updateLine(l.id, { workers: e.target.value })} />
                      </label>
                      <label className="est-field">
                        <span className="est-label">作業回数</span>
                        <input type="number" min={1} step={1} value={l.count} onChange={(e) => updateLine(l.id, { count: e.target.value })} />
                      </label>
                      <label className="est-field">
                        <span className="est-label">床下・高所・特殊作業</span>
                        <select value={l.hazardFactor} onChange={(e) => updateLine(l.id, { hazardFactor: e.target.value })}>
                          <option value="0.1">なし（基本）</option>
                          <option value="1">あり（床下・高所・特殊）</option>
                        </select>
                      </label>
                    </div>

                    <div className="est-row-3">
                      <label className="est-field">
                        <span className="est-label">報告書作成費用</span>
                        <select value={l.reportFee} onChange={(e) => updateLine(l.id, { reportFee: e.target.value })}>
                          {REPORT_FEE_OPTIONS.map((o) => (
                            <option key={o.v} value={o.v}>
                              ¥{Number(o.v).toLocaleString()}　{o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="est-field">
                        <span className="est-label">割増料金（施工人件費に）</span>
                        <select value={l.laborSurcharge} onChange={(e) => updateLine(l.id, { laborSurcharge: e.target.value })}>
                          {SURCHARGE_OPTIONS.map((o) => (
                            <option key={o.v} value={o.v}>
                              ×{o.v}　{o.label}
                            </option>
                          ))}
                        </select>
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
                    </div>

                    <div className="est-row-2">
                      <label className="est-field">
                        <span className="est-label">見積金額（空欄＝標準価格 {yen(r.standardPrice)}）</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={withCommas(l.priceOverride)}
                          onChange={(e) => updateLine(l.id, { priceOverride: stripDigits(e.target.value) })}
                          placeholder={r.standardPrice.toLocaleString()}
                        />
                      </label>
                      <label className="est-field">
                        <span className="est-label">値引額</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={withCommas(l.discount)}
                          onChange={(e) => updateLine(l.id, { discount: stripDigits(e.target.value) })}
                          placeholder="0"
                        />
                      </label>
                    </div>

                    {/* 計算ステータス（JUST.DB 照合用） */}
                    <div className="inline-actions">
                      <button type="button" className="btn-secondary" onClick={() => updateLine(l.id, { statusOpen: !l.statusOpen })}>
                        {l.statusOpen ? "▼ 計算ステータス" : "▶ 計算ステータス"}
                      </button>
                      <span className="est-chems-total">
                        標準価格 {yen(r.standardPrice)}／見積金額 {yen(r.amount)}／粗利率 {pct(r.grossMarginRate)}
                      </span>
                    </div>
                    {l.statusOpen ? (
                      <div className="est-result">
                        <div className="cell"><span className="k">薬剤売価_集計</span><span className="v">{yen(chemListSubtotal(l))}</span></div>
                        <div className="cell"><span className="k">薬剤売価_積算</span><span className="v">{yen(r.chemicalSale)}</span></div>
                        <div className="cell"><span className="k">薬剤原価_積算</span><span className="v">{yen(r.chemicalCost)}</span></div>
                        <div className="cell"><span className="k">移動コスト</span><span className="v">{yen(r.travelCost)}</span></div>
                        <div className="cell"><span className="k">施工人件費</span><span className="v">{yen(r.laborCost)}</span></div>
                        <div className="cell"><span className="k">割増分施工人件費</span><span className="v">{yen(r.laborSurchargeExtra)}</span></div>
                        <div className="cell"><span className="k">諸経費</span><span className="v">{yen(r.overhead)}</span></div>
                        <HintCell
                          label="労働安全衛生費"
                          value={yen(r.safetyCost)}
                          hint="ROUNDUP(労安費率 × 床下係数 × 施工コスト, 百円)。床下・高所・特殊作業ありで係数1（フル16%）、基本は0.1（1.6%）。標準価格には入らず、経費控除後にだけ効く。"
                        />
                        <div className="cell"><span className="k">報告書作成費用_積算</span><span className="v">{yen(r.reportFee)}</span></div>
                        <div className="cell"><span className="k">施工コスト</span><span className="v">{yen(r.constructionCost)}</span></div>
                        <HintCell label="標準価格" value={yen(r.standardPrice)} hint="施工コスト ÷ 原価係数。見積金額の既定値。" />
                        <HintCell
                          label="標準価格(薬剤吸収)"
                          value={yen(r.standardPriceChemAbsorbed)}
                          hint="薬剤を売価（原価×掛率1.6）のまま計上し、原価係数の施工マージンは労務・移動・報告書にだけ掛けた価格。薬剤に施工マージンを乗せない版（薬剤ゼロなら標準価格と同値）。"
                        />
                        <HintCell
                          label="経費控除後見積金額"
                          value={yen(r.netAfterExpenses)}
                          hint="見積金額から材料（薬剤売価）・移動・報告書・諸経費・労安・割増分を引いた残り＝工賃＋利益の取り分。施工人件費（原価）を上回れば工賃で黒字。診断用で最終価格には効かない。"
                        />
                        <div className="cell"><span className="k">粗利額 / 粗利率</span><span className="v">{yen(r.grossProfit)} / {pct(r.grossMarginRate)}</span></div>
                        <div className="cell"><span className="k">施工時間変換</span><span className="v">{laborHoursOf(l).toFixed(2)}</span></div>
                        <div className="cell"><span className="k">人件費単価 / 移動単価</span><span className="v">¥{settings.laborUnitPrice.toLocaleString()} / ¥{settings.travelUnitPrice.toLocaleString()}</span></div>
                        <div className="cell"><span className="k">諸経費率 / 労安費率</span><span className="v">{pct(settings.overheadRate)} / {pct(settings.safetyRate)}</span></div>
                        <div className="cell"><span className="k">薬剤係数 / 消費税率</span><span className="v">{settings.chemicalMarkup} / {pct(settings.taxRate)}</span></div>
                        <div className="cell"><span className="k">原価係数 / 床下係数</span><span className="v">{l.costCoefficient} / {l.hazardFactor}</span></div>
                      </div>
                    ) : null}
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

      {/* 合計：画面下部に貼り付いてスクロール追随 */}
      <div className="est-sticky-total">
        <div className="st-item">
          <span className="st-k">見積本体価格</span>
          <span className="st-v">{yen(calc.subtotal)}</span>
        </div>
        <div className="st-item">
          <span className="st-k">消費税（{pct(settings.taxRate)}）</span>
          <span className="st-v">{yen(calc.tax)}</span>
        </div>
        <div className="st-item primary">
          <span className="st-k">税込見積金額</span>
          <span className="st-v">{yen(calc.total)}</span>
        </div>
        <div className="st-item">
          <span className="st-k">粗利額 / 粗利率（全体）</span>
          <span className="st-v">{yen(calc.grossProfitTotal)} / {pct(calc.grossMarginRate)}</span>
        </div>
      </div>
    </div>
  );
}
