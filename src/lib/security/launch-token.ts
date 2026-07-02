import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const launchTokenPayloadSchema = z.object({
  caseId: z.string().min(1).max(100),
  investigationId: z.string().max(100).optional(),
  constructionId: z.string().max(100).optional(),
  driveFolderId: z.string().max(200).optional(),
  exp: z.coerce.number().int().positive()
});

export type LaunchTokenPayload = z.infer<typeof launchTokenPayloadSchema>;

const envSchema = z.object({
  REPORT_LINK_SECRET: z.string().min(16)
});

/**
 * 起動トークン検証に必要な秘密鍵を取得する。
 */
function getSecret(): string {
  return envSchema.parse({ REPORT_LINK_SECRET: process.env.REPORT_LINK_SECRET })
    .REPORT_LINK_SECRET;
}

/**
 * URL安全なBase64文字列をバイト列へ復元する。
 */
function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/** 内部ポータル等が自前でリンクを発行するための既定有効期限（秒）。IAP内で使う短命トークン。 */
const DEFAULT_LAUNCH_TTL_SECONDS = 12 * 60 * 60; // 12h

/**
 * 起動トークンを採番する（**サーバー専用**・`REPORT_LINK_SECRET` を使う）。
 *
 * 用途：IAP 配下の内部ポータル（`/portal`）が `caseId` から各編集面
 * （`/report/photo` 等・token 必須）へ deep-link する際に、その場でトークンを発行する。
 * これにより `/report/photo` 側の「token＝フォルダ許可のケイパビリティ」という契約を変えずに、
 * ポータルを“信頼できる発行者”として合流させられる（門は IAP・token は短命）。
 *
 * @param payload `exp` は省略可（省略時 now + ttlSeconds）
 */
export function signLaunchToken(
  payload: Omit<LaunchTokenPayload, "exp"> & { exp?: number },
  ttlSeconds = DEFAULT_LAUNCH_TTL_SECONDS
): string {
  const exp =
    payload.exp ?? Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const full = launchTokenPayloadSchema.parse({ ...payload, exp });
  const secret = getSecret();
  const encodedPayload = Buffer.from(JSON.stringify(full), "utf-8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

/**
 * 起動トークン文字列を検証し、ペイロードを返す。
 *
 * @param token `payload.signature` 形式のトークン
 * @throws 形式不正、署名不一致、有効期限切れの場合
 */
export function verifyLaunchToken(token: string): LaunchTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new Error("トークン形式が不正です。");
  }

  const [encodedPayload, encodedSignature] = parts;
  const secret = getSecret();

  const expectedSignature = createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  const actualBuf = fromBase64Url(encodedSignature);
  const expectedBuf = fromBase64Url(expectedSignature);

  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    throw new Error("トークン署名が一致しません。");
  }

  const payloadJson = fromBase64Url(encodedPayload).toString("utf-8");
  const payload = launchTokenPayloadSchema.parse(JSON.parse(payloadJson));

  const nowUnix = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowUnix) {
    throw new Error("トークンの有効期限が切れています。");
  }

  return payload;
}
