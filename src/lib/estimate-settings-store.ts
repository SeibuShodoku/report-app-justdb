/**
 * 見積（リング2）の計算式設定（`estimate_settings`）の読み書き（サーバー専用）。
 *
 * 版（識別キー＝値上げ改定の前後）を持ち、見積日に有効な版を計算エンジンへ渡す。
 * DB は snake_case、アプリは camelCase。ここで相互変換する。
 * 仕様: docs/spec/estimate/ring2-estimate.md（着手時）/ vision/case-portal.md §9（リング2）
 */
import { sbSelect, sbUpsert, supabaseConfigured } from "@/lib/supabase-rest";
import type { EstimateSettings } from "@/lib/estimate-calc";
import {
  DEFAULT_ESTIMATE_SETTINGS,
  type EstimateSettingsVersionInput
} from "@/schemas/estimate-settings";

/** 永続化された設定版（id・版メタ・作成情報付き）。率・単価は EstimateSettings を満たす。 */
export interface EstimateSettingsVersion extends EstimateSettings {
  id: number;
  label: string;
  effectiveFrom: string; // YYYY-MM-DD
  isActive: boolean;
  note?: string;
  createdBy?: string;
  createdAt?: string;
}

type Row = {
  id: number;
  label: string;
  effective_from: string;
  labor_unit_price: number | string;
  travel_unit_price: number | string;
  safety_rate: number | string;
  overhead_rate: number | string;
  chemical_markup: number | string;
  tax_rate: number | string;
  cost_coefficient_options: (number | string)[] | null;
  is_active: boolean;
  note: string | null;
  created_by: string | null;
  created_at: string | null;
};

function rowToVersion(r: Row): EstimateSettingsVersion {
  return {
    id: r.id,
    label: r.label,
    effectiveFrom: r.effective_from,
    laborUnitPrice: Number(r.labor_unit_price),
    travelUnitPrice: Number(r.travel_unit_price),
    safetyRate: Number(r.safety_rate),
    overheadRate: Number(r.overhead_rate),
    chemicalMarkup: Number(r.chemical_markup),
    taxRate: Number(r.tax_rate),
    costCoefficientOptions: (r.cost_coefficient_options ?? []).map(Number),
    isActive: r.is_active,
    note: r.note ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at ?? undefined
  };
}

/** 設定版を新しい順（適用開始日 desc）で全件取得。 */
export async function listSettingsVersions(): Promise<EstimateSettingsVersion[]> {
  if (!supabaseConfigured()) return [];
  const rows = await sbSelect<Row>(
    `estimate_settings?select=*&order=effective_from.desc,id.desc`
  );
  return rows.map(rowToVersion);
}

/** 設定版を1件作成（＝値上げ改定）。 */
export async function createSettingsVersion(
  input: EstimateSettingsVersionInput,
  createdBy: string | null
): Promise<EstimateSettingsVersion> {
  const [row] = await sbUpsert<Row>("estimate_settings", {
    label: input.label,
    effective_from: input.effectiveFrom,
    labor_unit_price: input.laborUnitPrice,
    travel_unit_price: input.travelUnitPrice,
    safety_rate: input.safetyRate,
    overhead_rate: input.overheadRate,
    chemical_markup: input.chemicalMarkup,
    tax_rate: input.taxRate,
    cost_coefficient_options: input.costCoefficientOptions,
    is_active: input.isActive,
    note: input.note ?? null,
    created_by: createdBy,
    updated_at: new Date().toISOString()
  });
  return rowToVersion(row);
}

/** 率・単価だけ取り出して計算エンジンの EstimateSettings にする。 */
export function toEngineSettings(v: EstimateSettings): EstimateSettings {
  return {
    laborUnitPrice: v.laborUnitPrice,
    travelUnitPrice: v.travelUnitPrice,
    safetyRate: v.safetyRate,
    overheadRate: v.overheadRate,
    chemicalMarkup: v.chemicalMarkup,
    taxRate: v.taxRate,
    costCoefficientOptions: v.costCoefficientOptions
  };
}

/**
 * 純粋関数：見積日（YYYY-MM-DD）に有効な版を選ぶ。
 * is_active かつ effective_from <= 見積日 のうち、最も新しい effective_from。該当なしは null。
 */
export function resolveSettingsForDate(
  versions: EstimateSettingsVersion[],
  date: string
): EstimateSettingsVersion | null {
  const effective = versions
    .filter((v) => v.isActive && v.effectiveFrom <= date)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return effective[0] ?? null;
}

/** 見積日に有効な計算式設定を返す（未構成・有効な版なしは既定へフォールバック）。 */
export async function loadSettingsForDate(date: string): Promise<EstimateSettings> {
  if (!supabaseConfigured()) return DEFAULT_ESTIMATE_SETTINGS;
  try {
    const versions = await listSettingsVersions();
    const resolved = resolveSettingsForDate(versions, date);
    return resolved ? toEngineSettings(resolved) : DEFAULT_ESTIMATE_SETTINGS;
  } catch {
    return DEFAULT_ESTIMATE_SETTINGS;
  }
}
