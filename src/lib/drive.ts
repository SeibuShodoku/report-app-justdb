/**
 * Google Drive への最小クライアント（画像プロキシ BFF 用）。
 * - SDK 非依存（fetch のみ）。SA 認証の JWT だけ node:crypto で組む（依存を増やさない）。
 * - サーバー専用。SA 鍵はクライアントへ渡さない。
 * - 用途は読み取りのみ（一覧 files.list / メタ files.get / 実体 alt=media）。
 *
 * 仕様: report-app-justdb/docs/spec/slack-photo-report.md §7（画像プロキシ）
 */
import { createSign } from "node:crypto";

const SA_KEY_JSON = process.env.GOOGLE_SA_KEY_JSON;
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type DriveImage = {
  fileId: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
};

/** SA 鍵が環境に設定済みか。 */
export function driveConfigured(): boolean {
  return Boolean(SA_KEY_JSON);
}

function getServiceAccount(): ServiceAccountKey {
  if (!SA_KEY_JSON) {
    throw new Error("GOOGLE_SA_KEY_JSON が未設定です。");
  }
  const sa = JSON.parse(SA_KEY_JSON) as ServiceAccountKey;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GOOGLE_SA_KEY_JSON に client_email / private_key がありません。");
  }
  return sa;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

// アクセストークンのプロセス内キャッシュ（expiry の少し手前で失効扱い）。
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * SA の JWT bearer フローでアクセストークンを取得する（キャッシュ付き）。
 */
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.value;
  }

  const sa = getServiceAccount();
  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: DRIVE_SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600
    })
  );
  const signingInput = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .end()
    .sign(sa.private_key);
  const assertion = `${signingInput}.${base64Url(signature)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }),
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`SA トークン取得失敗 ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: now + json.expires_in
  };
  return json.access_token;
}

/**
 * フォルダ内の画像を列挙する q を組み立てる（純粋関数・テスト対象）。
 */
export function buildFolderImagesQuery(folderId: string): string {
  const safe = folderId.replace(/'/g, "\\'");
  return `'${safe}' in parents and mimeType contains 'image/' and trashed = false`;
}

/**
 * 指定フォルダ直下の画像を作成日時順で全件返す（ページング対応）。
 */
export async function driveListImages(folderId: string): Promise<DriveImage[]> {
  const token = await getAccessToken();
  const images: DriveImage[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: buildFolderImagesQuery(folderId),
      fields: "nextPageToken, files(id, name, mimeType, createdTime, size)",
      orderBy: "createdTime",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    });
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!res.ok) {
      throw new Error(`Drive files.list ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        createdTime: string;
        size?: string;
      }>;
    };
    for (const f of json.files ?? []) {
      images.push({
        fileId: f.id,
        name: f.name,
        mimeType: f.mimeType,
        createdTime: f.createdTime,
        size: f.size
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);

  return images;
}

/**
 * ファイルの親フォルダ・MIME を取得する（フォルダ所属の検証用）。
 */
export async function driveGetFileMeta(
  fileId: string
): Promise<{ parents: string[]; mimeType: string; name: string }> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    fields: "id, parents, mimeType, name",
    supportsAllDrives: "true"
  });
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Drive files.get(meta) ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    parents?: string[];
    mimeType: string;
    name: string;
  };
  return { parents: json.parents ?? [], mimeType: json.mimeType, name: json.name };
}

/**
 * ファイル実体を取得する（alt=media）。Content-Type 付きの fetch Response を返し、
 * ルート側でそのままストリームできるようにする。
 */
export async function driveGetMedia(fileId: string): Promise<Response> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Drive files.get(media) ${res.status}: ${await res.text()}`);
  }
  return res;
}
