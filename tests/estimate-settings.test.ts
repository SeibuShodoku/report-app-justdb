import { describe, expect, it } from "vitest";
import {
  resolveSettingsForDate,
  toEngineSettings,
  type EstimateSettingsVersion
} from "@/lib/estimate-settings-store";
import {
  DEFAULT_ESTIMATE_SETTINGS,
  estimateSettingsSchema,
  estimateSettingsVersionInputSchema
} from "@/schemas/estimate-settings";

const mkVersion = (
  id: number,
  label: string,
  effectiveFrom: string,
  over: Partial<EstimateSettingsVersion> = {}
): EstimateSettingsVersion => ({
  id,
  label,
  effectiveFrom,
  isActive: true,
  laborUnitPrice: 5800,
  travelUnitPrice: 270,
  safetyRate: 0.16,
  overheadRate: 0.2,
  chemicalMarkup: 1.6,
  taxRate: 0.1,
  costCoefficientOptions: [0.3, 0.55],
  ...over
});

describe("estimateSettingsSchema", () => {
  it("既定値をパースできる", () => {
    expect(estimateSettingsSchema.safeParse(DEFAULT_ESTIMATE_SETTINGS).success).toBe(true);
  });

  it("原価係数の選択肢は省略時 [] になる", () => {
    const r = estimateSettingsSchema.parse({
      laborUnitPrice: 5800,
      travelUnitPrice: 270,
      safetyRate: 0.16,
      overheadRate: 0.2,
      chemicalMarkup: 1.6,
      taxRate: 0.1
    });
    expect(r.costCoefficientOptions).toEqual([]);
  });

  it("率が1超なら失敗", () => {
    expect(
      estimateSettingsSchema.safeParse({ ...DEFAULT_ESTIMATE_SETTINGS, taxRate: 1.2 }).success
    ).toBe(false);
  });
});

describe("estimateSettingsVersionInputSchema", () => {
  it("識別キー＋適用開始日があれば成功", () => {
    const r = estimateSettingsVersionInputSchema.safeParse({
      ...DEFAULT_ESTIMATE_SETTINGS,
      label: "2026年度06月",
      effectiveFrom: "2026-04-01"
    });
    expect(r.success).toBe(true);
  });

  it("適用開始日が YYYY-MM-DD でないと失敗", () => {
    const r = estimateSettingsVersionInputSchema.safeParse({
      ...DEFAULT_ESTIMATE_SETTINGS,
      label: "x",
      effectiveFrom: "2026/04/01"
    });
    expect(r.success).toBe(false);
  });
});

describe("resolveSettingsForDate", () => {
  const versions = [
    mkVersion(3, "2026年度10月", "2026-10-01", { laborUnitPrice: 6000 }),
    mkVersion(2, "2026年度06月", "2026-04-01", { laborUnitPrice: 5800 }),
    mkVersion(1, "2025年度", "2025-04-01", { laborUnitPrice: 5500 })
  ];

  it("見積日に有効な最新版（effective_from <= 見積日 の最大）を選ぶ", () => {
    expect(resolveSettingsForDate(versions, "2026-06-22")?.id).toBe(2); // 06月版
    expect(resolveSettingsForDate(versions, "2026-11-01")?.id).toBe(3); // 10月版
    expect(resolveSettingsForDate(versions, "2025-12-01")?.id).toBe(1); // 2025版
  });

  it("どの版より前なら null（→ 呼び出し側が既定へフォールバック）", () => {
    expect(resolveSettingsForDate(versions, "2020-01-01")).toBeNull();
  });

  it("無効化(is_active=false)された版は選ばれない", () => {
    const withDisabled = [mkVersion(4, "誤登録", "2026-05-01", { isActive: false }), ...versions];
    expect(resolveSettingsForDate(withDisabled, "2026-06-22")?.id).toBe(2);
  });

  it("toEngineSettings は率・単価だけを取り出す", () => {
    const eng = toEngineSettings(versions[1]);
    expect(eng).toEqual({
      laborUnitPrice: 5800,
      travelUnitPrice: 270,
      safetyRate: 0.16,
      overheadRate: 0.2,
      chemicalMarkup: 1.6,
      taxRate: 0.1,
      costCoefficientOptions: [0.3, 0.55]
    });
    expect("id" in eng).toBe(false);
  });
});
