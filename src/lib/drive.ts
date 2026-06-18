/**
 * Google Drive への最小クライアント（画像プロキシ BFF 用）。
 * - SDK 非依存（fetch のみ）。
 * - サーバー専用。OAuth クライアント秘密 / refresh token はクライアントへ渡さない。
 * - 認証は「社内ユーザーの OAuth refresh token」方式（dispatch-app の標準と同じ。
 *   `seibu-shodoku-dispatch-app/gas/20_oauth_token.gs` 参照）。
 *   外部サービスアカウントだと社内 Drive のフォルダ継承が効かず中身を読めないため、
 *   ドメイン内ユーザーとして読む（フォルダはドメイン共有なので社内ユーザーなら可）。
 * - 用途は読み取りのみ（一覧 files.list / メタ files.get / 実体 alt=media）。
 *
 * 仕様: report-app-justdb/docs/spec/slack-photo-report.md §7（画像プロキシ）
 */
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export type DriveImage = {
  fileId: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
};

/** OAuth 認証情報が環境に揃っているか。 */
export function driveConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

// アクセストークンのプロセス内キャッシュ（expiry の少し手前で失効扱い）。
let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * refresh token をアクセストークンに交換する（キャッシュ付き）。
 * dispatch-app `fetchAccessTokenByRefreshToken` と同じ grant_type=refresh_token。
 */
async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.value;
  }
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_DRIVE_REFRESH_TOKEN が未設定です。"
    );
  }

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`OAuth トークン更新失敗 ${res.status}: ${await res.text()}`);
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
