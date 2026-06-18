/**
 * 画像プロキシ（/api/folder, /api/photo）の認可。
 * 同一エンドポイントを 2 種の相手が叩くため入口で出し分ける（仕様 §7）。
 * - ブラウザ: 起動トークン（token クエリ）。token が許可する driveFolderId が要求フォルダと一致すること。
 * - サーバー間（VM）: 共有シークレット（x-proxy-secret ヘッダ）。
 */
import { timingSafeEqual } from "node:crypto";
import { verifyLaunchToken } from "@/lib/security/launch-token";

const SERVER_SECRET = process.env.DRIVE_PROXY_SERVER_SECRET;
const SERVER_HEADER = "x-proxy-secret";

export type ProxyAuth =
  | { ok: true; mode: "server" }
  | { ok: true; mode: "browser"; caseId: string; driveFolderId: string }
  | { ok: false; status: number; error: string };

/** 長さガード付きの定時間比較。 */
function secretMatches(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 要求フォルダ（folderId）へのアクセスを認可する。
 */
export function authorizeFolderAccess(request: Request, folderId: string): ProxyAuth {
  // 1) サーバー間（VM）: 共有シークレット
  const presented = request.headers.get(SERVER_HEADER);
  if (presented) {
    if (SERVER_SECRET && secretMatches(presented, SERVER_SECRET)) {
      return { ok: true, mode: "server" };
    }
    return { ok: false, status: 401, error: "サーバーシークレットが一致しません。" };
  }

  // 2) ブラウザ: 起動トークン
  const token = new URL(request.url).searchParams.get("token");
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "認証情報がありません（token クエリ か x-proxy-secret ヘッダ）。"
    };
  }
  try {
    const payload = verifyLaunchToken(token);
    if (!payload.driveFolderId || payload.driveFolderId !== folderId) {
      return { ok: false, status: 403, error: "トークンが許可するフォルダ外です。" };
    }
    return {
      ok: true,
      mode: "browser",
      caseId: payload.caseId,
      driveFolderId: payload.driveFolderId
    };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      error: error instanceof Error ? error.message : "トークン検証に失敗しました。"
    };
  }
}
