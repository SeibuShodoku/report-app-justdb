/**
 * IAP が注入する認証ユーザーのメールを取り出す。
 *
 * report-app は Cloud Run `--no-allow-unauthenticated`＋**IAP** 配下のため、ブラウザ要求には
 * 必ず `X-Goog-Authenticated-User-Email` が付く（IAP がクライアント偽装値を除去し自前で付与）。
 * ＝ブラウザ経路ではこのヘッダを信頼してよい（VM 経路は x-proxy-secret で別認可）。
 * ローカル開発（IAP なし）では存在しない → null（本人制限は識別できる時だけ効かせる）。
 *
 * 仕様: docs/deployment.md（IAP アクセスモデル）
 */
export function iapUserEmail(headers: Headers): string | null {
  const raw = headers.get("x-goog-authenticated-user-email");
  if (!raw) return null;
  // 形式は "accounts.google.com:user@domain" 等。最後の ':' 以降をメールとして採用。
  const idx = raw.lastIndexOf(":");
  const email = (idx >= 0 ? raw.slice(idx + 1) : raw).trim().toLowerCase();
  return email || null;
}
