/**
 * Supabase REST(PostgREST) への最小クライアント。
 * - SDK 非依存（fetch のみ）。
 * - サーバー専用（サービスロールキーを使う）。クライアントへは渡さない。
 */

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function supabaseConfigured(): boolean {
  return Boolean(URL && KEY);
}

/**
 * PostgREST に GET し、行配列を返す。
 * @param path 例: `pests?select=name&order=name`
 */
export async function sbSelect<T = Record<string, unknown>>(
  path: string
): Promise<T[]> {
  if (!URL || !KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  }
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  return (await res.json()) as T[];
}

/**
 * PostgREST に upsert（衝突時マージ）。返り値は挿入/更新された行。
 * @param table 例: `photo_reports`
 * @param row 1行オブジェクト（PK を含めること）
 * @param onConflict 衝突対象カラム（例: `folder_id`）。PK と同じなら省略可。
 */
export async function sbUpsert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
  onConflict?: string
): Promise<T[]> {
  if (!URL || !KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  }
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
  const res = await fetch(`${URL}/rest/v1/${table}${qs}`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(row),
    cache: "no-store"
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert ${res.status}: ${body}`);
  }
  return (await res.json()) as T[];
}

/**
 * PostgREST に PATCH（更新）。返り値は更新された行。
 * @param path 例: `photo_report_jobs?id=eq.5`
 */
export async function sbPatch<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>
): Promise<T[]> {
  if (!URL || !KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  }
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase patch ${res.status}: ${text}`);
  }
  return (await res.json()) as T[];
}
