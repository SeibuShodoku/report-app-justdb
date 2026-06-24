import { readFileSync } from "node:fs";

/**
 * 販売価格表（薬剤資材マスタ）の JUST.DB エクスポートCSV を Supabase `chemical_products` に取り込む。
 *
 * 価格データはリポジトリに焼かず、ここでランタイム取り込みする（CSV は gitignore 済）。
 * CSV は Shift-JIS。1行目＝表示名ヘッダ、2行目＝field_id、3行目以降＝データ。
 *
 * usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/import-price-book.mjs "薬剤_資材マスタ_YYYYMMDD-HHMM.csv"
 */

const file = process.argv[2];
if (!file) {
  console.error('CSV パスを指定してください。例: node scripts/import-price-book.mjs "薬剤_資材マスタ_….csv"');
  process.exit(1);
}
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  process.exit(1);
}

/** Shift-JIS のバイト列を UTF-8 文字列へ（Node の full-ICU 前提）。 */
function decodeShiftJis(buf) {
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch {
    console.error("Shift-JIS デコードに失敗。`iconv -f SHIFT_JIS -t UTF-8` で UTF-8 化してから渡してください。");
    process.exit(1);
  }
}

/** 引用符・エスケープ("")・改行/カンマ埋め込みに対応した最小 CSV パーサ。 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // skip
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const num = (v) => {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
};
const str = (v) => {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
};
/** "2026/06/22 17:50:18" → "2026-06-22 17:50:18"（timestamptz が解釈できる形）。 */
const ts = (v) => {
  const s = String(v ?? "").trim();
  return s.length ? s.replace(/\//g, "-") : null;
};

const rows = parseCsv(decodeShiftJis(readFileSync(file)));
if (rows.length < 3) {
  console.error("データ行がありません。");
  process.exit(1);
}
const header = rows[0];
const col = (name) => header.indexOf(name); // 表示名で引く（列順非依存）
const idx = {
  priceTableId: col("販売価格表ID"),
  productName: col("薬剤商品名"),
  reportName: col("報告書名"),
  category: col("中分類"),
  sale: col("薬剤売価"),
  cost: col("原価"),
  markup: col("販売掛率"),
  unit: col("単位"),
  usage: col("単位あたり使用量"),
  tags: col("検索タグ"),
  desc: col("薬剤説明"),
  note: col("備考"),
  supply: col("仕入一覧ID"),
  updated: col("更新日時")
};
if (idx.priceTableId < 0 || idx.productName < 0) {
  console.error("ヘッダに『販売価格表ID』『薬剤商品名』が見つかりません。CSV を確認してください。");
  process.exit(1);
}

const records = [];
for (const r of rows.slice(2)) {
  const id = str(r[idx.priceTableId]);
  const name = str(r[idx.productName]);
  if (!id || !name) continue; // キー欠落・空行は飛ばす
  records.push({
    price_table_id: id,
    product_name: name,
    report_name: str(r[idx.reportName]),
    category: str(r[idx.category]),
    sale_unit_price: num(r[idx.sale]) ?? 0,
    cost_unit_price: num(r[idx.cost]) ?? 0,
    markup: num(r[idx.markup]),
    unit: str(r[idx.unit]),
    usage_per_unit: num(r[idx.usage]),
    search_tags: str(r[idx.tags]),
    description: str(r[idx.desc]),
    note: str(r[idx.note]),
    supply_list_id: str(r[idx.supply]),
    source_updated_at: ts(r[idx.updated]),
    is_active: true,
    imported_at: new Date().toISOString()
  });
}

console.log(`取り込み対象: ${records.length} 品目`);

const res = await fetch(`${url}/rest/v1/chemical_products?on_conflict=price_table_id`, {
  method: "POST",
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal"
  },
  body: JSON.stringify(records)
});
if (!res.ok) {
  console.error(`Supabase upsert ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`✓ chemical_products に ${records.length} 品目を upsert しました。`);
