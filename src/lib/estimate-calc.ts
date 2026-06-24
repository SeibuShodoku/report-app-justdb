/**
 * 見積計算エンジン（純粋関数）— リング2（見積書）。
 *
 * JUST.DB の見積書（親＝表紙／子＝明細）の **原価積算（コストビルドアップ）** ロジックを TS で再実装したもの。
 * 売価＝品目カタログ引きでも自由入力でもなく、物理量（薬剤使用量・施工時間・人数・移動距離・坪数・回数）から
 * 原価を積み上げ、`原価係数`（=ユーザー選択の原価率）で標準価格を逆算する。
 *
 * **定数はハードコードしない。** 人件費単価・移動単価・各率・薬剤係数・消費税率は `EstimateSettings`
 * （版付き＝値上げ改定の前後で差し替え）として引数で受け取る。将来の管理画面（識別キー的な版管理＋計算式設定）が
 * この設定を供給する。エンジン自身は「設定 × 入力 → 結果」の写像に徹する。
 *
 * 検算根拠＝JUST.DB 実エクスポート（`tests/estimate-calc.test.ts` の fixture）。
 * 仕様: docs/spec/ring2-estimate.md（着手時に起こす）/ vision/case-portal.md §9（リング2）。
 *
 * 計算モデル（実データで検算済み・1行あたり）:
 *   一般施工金額計算:
 *     薬剤明細   = round(薬剤単価[売価] × 使用量)
 *     薬剤売価   = 薬剤明細 × 作業回数
 *     薬剤原価   = round(薬剤売価 ÷ 薬剤係数)              ※販売価格表は「売価」を持つ・原価は逆算
 *     施工人件費 = ROUND(人数 × 回数 × round(施工時間[h], 2) × 人件費単価)  ※割増は含めず別建て
 *     割増分施工人件費 = ROUNDUP(施工人件費 × (割増料金 − 1), 百円)  ※施工コストには入れない
 *     移動コスト = 移動単価 × 人数 × 回数 × km
 *     施工コスト = 薬剤原価 + 施工人件費 + 移動コスト + 報告書作成費用
 *     諸経費     = ROUNDUP(施工コスト × 諸経費率, 百円)
 *     労安費     = ROUNDUP(労安費率 × 床下高所特殊係数 × 施工コスト, 百円)
 *     標準価格   = round(施工コスト ÷ 原価係数)            ← 見積金額の既定（担当が手調整可）
 *   シロアリ坪単価計算:
 *     見積金額   = 坪単価 × 坪数                            ← 売価は坪で決まる（薬剤明細とは別フィールド）
 *     防蟻剤売価 = round(防蟻剤売価坪単価 × 坪数)           ← 薬剤ごとに変更可
 *     防蟻剤原価 = round(防蟻剤売価 ÷ 薬剤係数) → 施工コストへ
 *   共通:
 *     粗利額 = 見積金額 − 施工コスト ; 粗利率 = round(粗利額 ÷ 見積金額, 3)
 *   表紙:
 *     本体 = Σ 値引後見積金額 ; 消費税 = round(本体 × 消費税率) ; 税込 = 本体 + 消費税
 */

/** 計算式設定（版付き＝改定前後で差し替え。将来の管理画面が供給）。 */
export interface EstimateSettings {
  /** 施工人件費_単価（円/時） 例 5800 */
  laborUnitPrice: number;
  /** 移動費用_単価（円/km） 例 270 */
  travelUnitPrice: number;
  /** 労安費率 例 0.16 */
  safetyRate: number;
  /** 諸経費率 例 0.20 */
  overheadRate: number;
  /** 薬剤係数（原価→売価の倍率。販売価格表は売価を持つので原価は ÷係数） 例 1.6 */
  chemicalMarkup: number;
  /** 消費税率 例 0.10 */
  taxRate: number;
  /** 原価係数の選択肢（UI のプルダウン用。計算はユーザー選択値を明細ごとに受け取る） 例 [0.3, 0.55] */
  costCoefficientOptions?: number[];
}

/** 見積計算モード。一般施工金額計算 / シロアリ坪単価計算。 */
export type EstimateCalcMode = "general" | "termiteTsubo";

/** 明細内の薬剤1行（明細フィールド＝縦持ちサブテーブル。1明細に複数ぶら下がる）。 */
export interface EstimateChemicalInput {
  /** 薬剤単価（売価, 円/単位） */
  unitPrice?: number;
  /** 薬剤使用量 */
  qty?: number;
  /** 薬剤係数（販売掛率。売価÷係数＝原価。未指定は設定の既定） */
  markup?: number;
}

/** 明細1行の入力（担当が入れる物理量＋選択）。 */
export interface EstimateLineInput {
  mode: EstimateCalcMode;
  /** 原価係数（ユーザー選択：例 0.3 / 0.55）。標準価格＝施工コスト÷この値。 */
  costCoefficient: number;
  /** 作業回数（人件費・移動・一般薬剤に掛かる）。既定 1。 */
  count?: number;

  // --- 薬剤（明細フィールド＝1明細に複数。販売価格表＝売価単価を引く） ---
  /** 薬剤明細（複数可）。各行 使用量×単価で売価、原価は行ごとの掛率で逆算して合算。 */
  chemicals?: EstimateChemicalInput[];
  /** @deprecated 単一薬剤の後方互換（1要素として畳み込む）。新規は chemicals[] を使う。 */
  chemicalUnitPrice?: number;
  /** @deprecated chemicals[] を使う。 */
  chemicalQty?: number;
  /** @deprecated chemicals[] を使う。 */
  chemicalMarkup?: number;

  // --- 労務 ---
  /** 施工時間（h, 小数）。内部で2桁に丸めてから乗算（＝JUST.DB の「施工時間変換」）。 */
  laborHours?: number;
  /** 作業人数。既定 1。 */
  workers?: number;
  /** 割増料金係数（明細＝施工人件費に効く。1=なし / 1.25=夜間・休日昼間 / 1.5=深夜）。既定 1。 */
  laborSurcharge?: number;

  // --- 移動 ---
  /** 移動距離（km） */
  travelKm?: number;

  // --- 係数・費用 ---
  /** 床下・高所・特殊作業係数（労安費に掛かる）。例 0.1 / 1。既定 1。 */
  hazardFactor?: number;
  /** 報告書作成費用（原価に算入） */
  reportFee?: number;

  // --- シロアリ坪単価モード ---
  /** 坪数 */
  tsubo?: number;
  /** 見積の坪単価（売価。見積金額＝坪単価×坪数） */
  tsuboUnitPrice?: number;
  /** 防蟻剤の売価坪単価（薬剤ごと。原価は ÷係数で算入） */
  termiteChemTsuboPrice?: number;
  /** 防蟻剤の販売掛率（未指定は設定の既定） */
  termiteChemMarkup?: number;

  // --- 売価の手調整 ---
  /** 見積金額の手入力（指定時は標準価格／坪単価計算を上書き） */
  priceOverride?: number;
  /** 値引額 */
  discount?: number;
}

/** 明細1行の算出結果。 */
export interface CalculatedLine {
  /** 薬剤売価（一般＝明細×回数 / シロアリ＝防蟻剤売価坪単価×坪） */
  chemicalSale: number;
  /** 薬剤原価（= round(薬剤売価 ÷ 薬剤係数)）→ 施工コストへ */
  chemicalCost: number;
  /** 施工人件費（= ROUND(人数×回数×施工時間変換×単価)。割増は含まない） */
  laborCost: number;
  /** 割増分施工人件費（= ROUNDUP(施工人件費×(割増−1), 百円)。施工コストには含めない別建て） */
  laborSurchargeExtra: number;
  /** 移動コスト（= 移動単価×人数×回数×移動距離） */
  travelCost: number;
  /** 報告書作成費用 */
  reportFee: number;
  /** 施工コスト（原価合計） */
  constructionCost: number;
  /** 諸経費 */
  overhead: number;
  /** 労働安全衛生費 */
  safetyCost: number;
  /** 標準価格（施工コスト ÷ 原価係数。見積金額の既定値） */
  standardPrice: number;
  /** 見積金額（標準価格／坪単価計算 or 手調整） */
  amount: number;
  /** 値引額 */
  discount: number;
  /** 値引後見積金額 */
  amountAfterDiscount: number;
  /** 粗利額（見積金額 − 施工コスト） */
  grossProfit: number;
  /** 粗利率（小数3桁） */
  grossMarginRate: number;
  /** 経費控除後見積金額（診断用。見積金額−移動−薬剤売価−報告書−諸経費−割増分−労安＋値引。最終価格に非関与） */
  netAfterExpenses: number;
}

/** 見積全体の算出結果（表紙ロールアップ）。 */
export interface CalculatedEstimate {
  lines: CalculatedLine[];
  /** 見積本体価格（Σ 値引後見積金額） */
  subtotal: number;
  /** 消費税額 */
  tax: number;
  /** 税込見積本体価格 */
  total: number;
  /** 施工コスト合計 */
  constructionCostTotal: number;
  /** 粗利額合計 */
  grossProfitTotal: number;
  /** 粗利率（合計ベース） */
  grossMarginRate: number;
}

/** ISO8601 duration（例 "P0DT1H0M0S" / "P0DT0H45M0S"）→ 時間（h, 小数）。UI 入力変換用。 */
export function parseIso8601DurationToHours(duration: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(duration.trim());
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (Number(d) || 0) * 24 + (Number(h) || 0) + (Number(min) || 0) / 60 + (Number(s) || 0) / 3600;
}

/** 四捨五入（0から離れる側＝Excel/JUST.DB の ROUND 準拠）。 */
function roundTo(x: number, digits: number): number {
  const f = 10 ** digits;
  // 2進浮動小数の誤差で 0.5 境界がぶれないよう微小イプシロンを足す
  return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
}

/** 百円単位の切上げ（Excel/JUST.DB の ROUNDUP(x, -2) 準拠）。 */
function roundUpTo100(x: number): number {
  return Math.ceil(x / 100 - 1e-9) * 100;
}

/** 明細1行を計算する。 */
export function calcLine(input: EstimateLineInput, settings: EstimateSettings): CalculatedLine {
  const count = input.count ?? 1;
  const workers = input.workers ?? 1;
  const hazardFactor = input.hazardFactor ?? 1;
  const reportFee = input.reportFee ?? 0;
  const discount = input.discount ?? 0;

  // 施工人件費 = ROUND(人数 × 回数 × 施工時間変換 × 単価)。割増は含めず別建て。
  const hours = roundTo(input.laborHours ?? 0, 2); // ＝施工時間変換
  const laborCost = roundTo(workers * count * hours * settings.laborUnitPrice, 0);
  // 割増分施工人件費 = ROUNDUP(施工人件費 × (割増料金 − 1), 百円)。施工コストには入れない。
  const laborSurchargeExtra = roundUpTo100(laborCost * ((input.laborSurcharge ?? 1) - 1));
  // 移動コスト = 移動単価 × 人数 × 回数 × 移動距離。
  const travelCost = settings.travelUnitPrice * workers * count * (input.travelKm ?? 0);

  // 薬剤（明細フィールド＝複数可）。各行 round(売価単価 × 使用量) を回数分、原価は行ごとの掛率で逆算して合算。
  // 単一フィールド（chemicalUnitPrice/Qty/Markup）は後方互換のため1要素として畳み込む。
  const chemRows: EstimateChemicalInput[] = [...(input.chemicals ?? [])];
  if (input.chemicalUnitPrice != null || input.chemicalQty != null) {
    chemRows.push({
      unitPrice: input.chemicalUnitPrice,
      qty: input.chemicalQty,
      markup: input.chemicalMarkup
    });
  }
  // 薬剤売価_積算 = Σ(round(単価×使用量) × 回数)。原価_積算 = ROUND(売価_積算 ÷ 係数) を掛率グループごとに1回。
  // （JUST.DB は売価を合計してから原価を1回だけ丸める。掛率が品目で異なる場合に備え、掛率ごとに小計して丸める。）
  const saleByMarkup = new Map<number, number>();
  let chemicalSale = 0;
  for (const c of chemRows) {
    const rowSale = roundTo((c.unitPrice ?? 0) * (c.qty ?? 0), 0) * count;
    if (rowSale <= 0) continue;
    const mk = c.markup ?? settings.chemicalMarkup;
    chemicalSale += rowSale;
    saleByMarkup.set(mk, (saleByMarkup.get(mk) ?? 0) + rowSale);
  }
  // シロアリ坪単価モード：防蟻剤（売価坪単価 × 坪数）も売価に合算（坪で確定＝回数は掛けない）。
  if (input.mode === "termiteTsubo" && input.termiteChemTsuboPrice) {
    const tsuboSale = roundTo(input.termiteChemTsuboPrice * (input.tsubo ?? 0), 0);
    if (tsuboSale > 0) {
      const mk = input.termiteChemMarkup ?? settings.chemicalMarkup;
      chemicalSale += tsuboSale;
      saleByMarkup.set(mk, (saleByMarkup.get(mk) ?? 0) + tsuboSale);
    }
  }
  let chemicalCost = 0;
  for (const [mk, sale] of saleByMarkup) {
    chemicalCost += mk > 0 ? roundTo(sale / mk, 0) : 0;
  }

  // 施工コスト（原価合計）
  const constructionCost = chemicalCost + laborCost + travelCost + reportFee;

  // 経費（施工コストに率を掛けて百円切上）
  const overhead = roundUpTo100(constructionCost * settings.overheadRate);
  const safetyCost = roundUpTo100(settings.safetyRate * hazardFactor * constructionCost);

  // 標準価格（原価 ÷ 原価係数）。見積金額の既定。
  const standardPrice =
    input.costCoefficient > 0 ? roundTo(constructionCost / input.costCoefficient, 0) : 0;

  // 見積金額：シロアリは坪単価×坪、一般は標準価格。いずれも手調整(priceOverride)が最優先。
  const tsuboPrice = (input.tsuboUnitPrice ?? 0) * (input.tsubo ?? 0);
  const defaultAmount = input.mode === "termiteTsubo" ? tsuboPrice : standardPrice;
  const amount = input.priceOverride ?? defaultAmount;

  const amountAfterDiscount = amount - discount;
  const grossProfit = amount - constructionCost;
  const grossMarginRate = amount > 0 ? roundTo(grossProfit / amount, 3) : 0;

  // 経費控除後見積金額（診断用・最終価格に非関与）。
  const netAfterExpenses =
    amount - travelCost - chemicalSale - reportFee - overhead - laborSurchargeExtra - safetyCost + discount;

  return {
    chemicalSale,
    chemicalCost,
    laborCost,
    laborSurchargeExtra,
    travelCost,
    reportFee,
    constructionCost,
    overhead,
    safetyCost,
    standardPrice,
    amount,
    discount,
    amountAfterDiscount,
    grossProfit,
    grossMarginRate,
    netAfterExpenses
  };
}

/** 見積全体（明細→表紙ロールアップ＋消費税）を計算する。 */
export function calcEstimate(
  lines: EstimateLineInput[],
  settings: EstimateSettings
): CalculatedEstimate {
  const calculated = lines.map((l) => calcLine(l, settings));
  const subtotal = calculated.reduce((s, l) => s + l.amountAfterDiscount, 0);
  const tax = roundTo(subtotal * settings.taxRate, 0);
  const total = subtotal + tax;
  const constructionCostTotal = calculated.reduce((s, l) => s + l.constructionCost, 0);
  const grossProfitTotal = subtotal - constructionCostTotal;
  const grossMarginRate = subtotal > 0 ? roundTo(grossProfitTotal / subtotal, 3) : 0;

  return {
    lines: calculated,
    subtotal,
    tax,
    total,
    constructionCostTotal,
    grossProfitTotal,
    grossMarginRate
  };
}
