/**
 * 案件アクセスの単一の“門”（サーバー専用）。
 *
 * 案件ポータル（`/portal`）と将来の顧客提示面は、**同じ案件・同じレンダラ**を共有する。
 * 違うのは「前に立つ門（誰として来たか／何を見せてよいか）」だけ——それをここに集約する。
 * ポータルUIは caseId を「どの案件か」の**セレクタ**としてしか扱わず、認可判断は必ず本関数を通す。
 *
 * 設計の芯（docs/vision/case-portal.md §4・§8）：
 * - **裏（社内）**＝IAP が門。@seibu-s.co.jp で認証済みなら全案件を見てよい前提のため、
 *   caseId は総当りされても安全な**セレクタ**（門は IAP 側）。→ `scope: "all"`。
 * - **表（顧客・近い将来／リング1c）**＝IAP 外。裸の caseId は総当りで全顧客に届くため門にならない。
 *   ケイパビリティ（署名付き・期限付き・失効可URL＝possession が認可）で `scope: "customer-visible"`。
 * - **表（顧客・遠い将来／双方向）**＝本人認証（個人=LINE / 法人=メール）＋「この本人はこの案件の所有者か」。
 *
 * ＝「param か否か」ではなく「caseId がセレクタか／ケイパビリティ・認可付きか」で分ける。
 */
import { verifyLaunchToken } from "@/lib/security/launch-token";

/**
 * ポータル試験運用の社内 allowlist（env `PORTAL_ALLOWED_EMAILS`・カンマ/空白区切り）。
 * Slack のポータルボタンは URL ボタン＝GAS 側ではクリックを止められない（開いた後に ACK が飛ぶだけ）ため、
 * 「誰が開けるか」はこの門で絞る。**未設定なら従来どおり IAP のみが門**（＝@seibu-s.co.jp 全員）。
 */
function portalAllowedEmails(): string[] {
  return (process.env.PORTAL_ALLOWED_EMAILS ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 誰として案件に来たか。裏＝staff（IAP）、表＝capability（署名URL）/ customer（本人認証）。 */
export type CaseSession =
  | { kind: "staff"; email: string | null }
  | { kind: "capability"; token: string }
  | { kind: "customer"; customerId: string };

/** 見せてよい範囲。all＝全成果物（社内）、customer-visible＝確定・顧客可視のみ（顧客面）。 */
export type CaseAccessScope = "all" | "customer-visible";

export type CaseAccess =
  | { allowed: true; scope: CaseAccessScope }
  | { allowed: false; reason: string };

/**
 * このセッションが当該案件を見てよいか、見てよいなら範囲は何かを決める。
 * 現状は裏（staff/IAP）のみ配線済み。表（capability/customer）は継ぎ目だけ用意し未配線。
 */
export function resolveCaseAccess(session: CaseSession, caseId: string): CaseAccess {
  if (!caseId) return { allowed: false, reason: "案件IDが空です。" };

  switch (session.kind) {
    case "staff": {
      // 裏＝IAP が門。ここに来られている時点で @seibu-s.co.jp 認証済み。caseId はセレクタ。
      // （ローカル開発は IAP ヘッダ無し＝email:null でも社内扱い。本番は IAP 手前で弾かれる。）
      // 試験運用中は PORTAL_ALLOWED_EMAILS で利用者をさらに絞る（設定がある間だけ効く狭い門）。
      const allow = portalAllowedEmails();
      if (allow.length > 0 && (!session.email || !allow.includes(session.email.toLowerCase()))) {
        return {
          allowed: false,
          reason: "案件ポータルは試験運用中のため、利用できるメンバーを限定しています。"
        };
      }
      return { allowed: true, scope: "all" };
    }

    case "capability": {
      // 表（近い将来・リング1c）：署名URL＝ケイパビリティ。possession が認可。
      // 継ぎ目のみ配線：トークンの caseId 一致まで確認し、可視範囲は顧客可視に限定する。
      // ※ 顧客提示サーフェスの本実装（IAP外デプロイ・失効・凍結参照）は別途。ここでは入口だけ。
      try {
        const payload = verifyLaunchToken(session.token);
        if (payload.caseId !== caseId) {
          return { allowed: false, reason: "トークンが許可する案件と一致しません。" };
        }
        return { allowed: true, scope: "customer-visible" };
      } catch (e) {
        return { allowed: false, reason: e instanceof Error ? e.message : "トークン検証に失敗しました。" };
      }
    }

    case "customer":
      // 表（遠い将来・双方向）：本人認証＋「この customerId はこの caseId の所有者か」の認可。
      // 個人=LINE / 法人=メール で本人性の粒度が変わる。未配線。
      return { allowed: false, reason: "顧客本人認証は未配線です。" };
  }
}
