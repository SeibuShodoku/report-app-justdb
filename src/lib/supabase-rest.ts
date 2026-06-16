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
