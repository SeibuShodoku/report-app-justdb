import { describe, expect, it } from "vitest";
import {
  calcEstimate,
  calcLine,
  parseIso8601DurationToHours,
  type EstimateLineInput,
  type EstimateSettings
} from "@/lib/estimate-calc";

/**
 * 検算 fixture は JUST.DB の実エクスポート（リポジトリ同梱の見積CSV・20260624）から起こした実レコード。
 * 値はすべて JUST.DB が算出した実値＝デグレ検知の基準。
 * 定数（人件費5800・移動270・労安0.16・諸経費0.20・薬剤係数1.6・消費税0.10）は当時の設定版。
 */
const settings: EstimateSettings = {
  laborUnitPrice: 5800,
  travelUnitPrice: 270,
  safetyRate: 0.16,
  overheadRate: 0.2,
  chemicalMarkup: 1.6,
  taxRate: 0.1,
  costCoefficientOptions: [0.3, 0.55]
};

describe("parseIso8601DurationToHours", () => {
  it("時/分/秒を時間（小数）に変換する", () => {
    expect(parseIso8601DurationToHours("P0DT1H0M0S")).toBeCloseTo(1, 10);
    expect(parseIso8601DurationToHours("P0DT0H45M0S")).toBeCloseTo(0.75, 10);
    expect(parseIso8601DurationToHours("P0DT0H30M0S")).toBeCloseTo(0.5, 10);
    expect(parseIso8601DurationToHours("P0DT0H20M0S")).toBeCloseTo(1 / 3, 10);
    expect(parseIso8601DurationToHours("P0DT3H0M0S")).toBeCloseTo(3, 10);
  });
});

describe("calcLine（一般施工金額計算）", () => {
  // 見積ID 55 / 枝番1（田尻団地）：薬剤なし・45分・移動15km・床下係数1・原価係数0.55・見積金額は手入力28000
  it("ID55: 薬剤なし・労務+移動の積算 → 標準価格/諸経費/労安/粗利", () => {
    const line: EstimateLineInput = {
      mode: "general",
      costCoefficient: 0.55,
      laborHours: 0.75,
      workers: 1,
      count: 1,
      travelKm: 15,
      hazardFactor: 1,
      priceOverride: 28000
    };
    const r = calcLine(line, settings);
    expect(r.laborCost).toBe(4350); // 5800 × 0.75
    expect(r.travelCost).toBe(4050); // 270 × 15
    expect(r.chemicalCost).toBe(0);
    expect(r.constructionCost).toBe(8400);
    expect(r.overhead).toBe(1700); // ROUNDUP(8400×0.2, 百円)
    expect(r.safetyCost).toBe(1400); // ROUNDUP(0.16×1×8400, 百円)
    expect(r.standardPrice).toBe(15273); // 8400 ÷ 0.55
    expect(r.amount).toBe(28000);
    expect(r.grossProfit).toBe(19600);
    expect(r.grossMarginRate).toBeCloseTo(0.7, 3);
  });

  // 見積ID 41 / 枝番2（全館消毒・ベクトラル散布）：薬剤あり・回数2・床下係数0.1・原価係数0.3・見積金額120000
  it("ID41-2: 薬剤(売価→原価)×回数・労務/移動×回数 → 施工コスト/標準価格/粗利率", () => {
    const line: EstimateLineInput = {
      mode: "general",
      costCoefficient: 0.3,
      chemicalUnitPrice: 58,
      chemicalQty: 30,
      laborHours: 1,
      workers: 1,
      count: 2,
      travelKm: 1,
      hazardFactor: 0.1,
      priceOverride: 120000
    };
    const r = calcLine(line, settings);
    expect(r.chemicalSale).toBe(3480); // round(58×30)=1740 ×回数2
    expect(r.chemicalCost).toBe(2175); // 3480 ÷ 1.6
    expect(r.laborCost).toBe(11600); // 5800 × 1h × 1人 × 2回
    expect(r.travelCost).toBe(540); // 270 × 1km × 2回
    expect(r.constructionCost).toBe(14315);
    expect(r.overhead).toBe(2900); // ROUNDUP(14315×0.2)
    expect(r.safetyCost).toBe(300); // ROUNDUP(0.16×0.1×14315)
    expect(r.standardPrice).toBe(47717); // 14315 ÷ 0.3
    expect(r.amount).toBe(120000);
    expect(r.grossProfit).toBe(105685);
    expect(r.grossMarginRate).toBeCloseTo(0.881, 3);
  });

  // 見積ID 56 / 枝番1（ゴキブリ駆除・スミチオン）：小数薬剤・見積金額未入力(0)＝原価のみ確定状態
  it("ID56: 小数薬剤の原価逆算と原価ビルドアップ（見積金額0でも原価は確定）", () => {
    const line: EstimateLineInput = {
      mode: "general",
      costCoefficient: 0.3,
      chemicalUnitPrice: 2.2,
      chemicalQty: 5,
      laborHours: 1,
      workers: 1,
      count: 1,
      travelKm: 5,
      hazardFactor: 0.1,
      priceOverride: 0
    };
    const r = calcLine(line, settings);
    expect(r.chemicalSale).toBe(11); // round(2.2×5)
    expect(r.chemicalCost).toBe(7); // round(11 ÷ 1.6)=round(6.875)
    expect(r.laborCost).toBe(5800);
    expect(r.travelCost).toBe(1350); // 270 × 5
    expect(r.constructionCost).toBe(7157);
    expect(r.overhead).toBe(1500); // ROUNDUP(7157×0.2)
    expect(r.safetyCost).toBe(200); // ROUNDUP(0.16×0.1×7157)
    expect(r.standardPrice).toBe(23857); // 7157 ÷ 0.3
    expect(r.amount).toBe(0);
    expect(r.grossProfit).toBe(-7157); // 見積金額未入力 → 原価ぶん赤
  });

  it("施工時間は2桁に丸めてから乗算する（20分×8人＝0.33で15312）", () => {
    const r = calcLine(
      { mode: "general", costCoefficient: 0.3, laborHours: parseIso8601DurationToHours("P0DT0H20M0S"), workers: 8, count: 1 },
      settings
    );
    expect(r.laborCost).toBe(15312); // 5800 × 0.33 × 8（生の0.3333だと15466で不一致）
  });
});

describe("calcLine（シロアリ坪単価計算）", () => {
  // 見積ID 58 / 枝番1（NIPPON総合学院）：坪15・坪単価8800・防蟻剤売価坪単価1989・原価係数0.55
  it("ID58: 見積金額＝坪単価×坪・防蟻剤は専用フィールドで原価算入", () => {
    const line: EstimateLineInput = {
      mode: "termiteTsubo",
      costCoefficient: 0.55,
      tsubo: 15,
      tsuboUnitPrice: 8800,
      termiteChemTsuboPrice: 1989,
      laborHours: 1,
      workers: 1,
      count: 1,
      hazardFactor: 0.1
    };
    const r = calcLine(line, settings);
    expect(r.chemicalSale).toBe(29835); // 1989 × 15
    expect(r.chemicalCost).toBe(18647); // 29835 ÷ 1.6
    expect(r.laborCost).toBe(5800);
    expect(r.constructionCost).toBe(24447); // 5800 + 18647
    expect(r.overhead).toBe(4900); // ROUNDUP(24447×0.2)
    expect(r.safetyCost).toBe(400); // ROUNDUP(0.16×0.1×24447)
    expect(r.amount).toBe(132000); // 8800 × 15
    expect(r.grossProfit).toBe(107553);
    expect(r.grossMarginRate).toBeCloseTo(0.815, 3);
  });
});

describe("calcEstimate（表紙ロールアップ＋消費税）", () => {
  // 見積ID 58（単一明細）：本体132000 → 消費税13200 → 税込145200
  it("ID58: 本体 → 消費税 → 税込", () => {
    const est = calcEstimate(
      [
        {
          mode: "termiteTsubo",
          costCoefficient: 0.55,
          tsubo: 15,
          tsuboUnitPrice: 8800,
          termiteChemTsuboPrice: 1989,
          laborHours: 1,
          hazardFactor: 0.1
        }
      ],
      settings
    );
    expect(est.subtotal).toBe(132000);
    expect(est.tax).toBe(13200);
    expect(est.total).toBe(145200);
  });

  // 見積ID 41（複数明細の合計）：30000+120000+120000+80000+202400 = 552400 → 税込607640
  it("ID41: 複数明細の本体合計と税込（手入力金額の積み上げ）", () => {
    const mk = (priceOverride: number): EstimateLineInput => ({
      mode: "general",
      costCoefficient: 0.3,
      priceOverride
    });
    const est = calcEstimate([mk(30000), mk(120000), mk(120000), mk(80000), mk(202400)], settings);
    expect(est.subtotal).toBe(552400);
    expect(est.tax).toBe(55240);
    expect(est.total).toBe(607640);
  });
});
