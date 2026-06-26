/**
 * Drive 書き込みクライアント（案件ダイジェスト「口」用）。
 * - サーバー専用。**書き込みは RW トークン**（scope=drive full）を使う。
 *   GOOGLE_DRIVE_RW_REFRESH_TOKEN があればそれ、無ければ GOOGLE_DRIVE_REFRESH_TOKEN
 *   （Cloud Run では後者に RW 値を設定済み・read+write 兼用）。
 * - AI 専用フォルダの作成・テキストファイルの upsert・読み取りを担う。
 *
 * 仕様: docs/architecture/slack-photo-report-architecture.md §4（口）
 */
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const RW_TOKEN = process.env.GOOGLE_DRIVE_RW_REFRESH_TOKEN;
const RO_TOKEN = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/** AI 専用フォルダ名（当面の仮名・env で変更可）。 */
export const AI_FOLDER_NAME = process.env.AI_WORKSPACE_FOLDER_NAME ?? "_ai";

export function driveWriteConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && (RW_TOKEN || RO_TOKEN));
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getWriteToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;
  const refresh = RW_TOKEN || RO_TOKEN;
  if (!CLIENT_ID || !CLIENT_SECRET || !refresh) {
    throw new Error("GOOGLE_CLIENT_ID/SECRET と (RW or) DRIVE_REFRESH_TOKEN が未設定です。");
  }
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token"
    }),
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Drive(write) token更新失敗 ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

/** フォルダ内で name に一致する非ゴミ箱ファイル/フォルダの id を返す（無ければ null）。 */
async function findChildByName(
  parentId: string,
  name: string,
  mimeType?: string
): Promise<string | null> {
  const token = await getWriteToken();
  const safe = name.replace(/'/g, "\\'");
  let q = `'${parentId.replace(/'/g, "\\'")}' in parents and name = '${safe}' and trashed = false`;
  if (mimeType) q += ` and mimeType = '${mimeType}'`;
  const params = new URLSearchParams({
    q,
    fields: "files(id)",
    pageSize: "1",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true"
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Drive files.list ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { files?: Array<{ id: string }> };
  return json.files?.[0]?.id ?? null;
}

/** 親フォルダ配下のサブフォルダを find-or-create して id を返す。 */
export async function ensureSubfolder(parentId: string, name: string): Promise<string> {
  const existing = await findChildByName(parentId, name, "application/vnd.google-apps.folder");
  if (existing) return existing;
  const token = await getWriteToken();
  const res = await fetch(`${DRIVE_API}/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
  });
  if (!res.ok) throw new Error(`Drive folder作成 ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** 既存サブフォルダを探す（作らない）。無ければ null。 */
export async function findSubfolder(parentId: string, name: string): Promise<string | null> {
  return findChildByName(parentId, name, "application/vnd.google-apps.folder");
}

/** フォルダ内のテキストファイルを name で upsert（あれば内容更新・無ければ作成）。fileId を返す。 */
export async function upsertTextFile(
  folderId: string,
  name: string,
  content: string,
  mimeType = "text/markdown"
): Promise<string> {
  const token = await getWriteToken();
  const existing = await findChildByName(folderId, name);
  if (existing) {
    const res = await fetch(
      `${UPLOAD_API}/files/${existing}?uploadType=media&supportsAllDrives=true`,
      { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType }, body: content }
    );
    if (!res.ok) throw new Error(`Drive 内容更新 ${res.status}: ${await res.text()}`);
    return existing;
  }
  const boundary = "b" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name, parents: [folderId] }) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;
  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error(`Drive ファイル作成 ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/**
 * 画像（バイナリ）をフォルダへ新規アップロードする。fileId/name を返す。
 * 写真報告のフェーズ1＝WEBから現場写真をその日の写真フォルダへ直接入れる導線で使う
 *（「先にDriveへ入れておく」前提を消す・正本アーキ §6/案件ポータル動線）。
 * バイナリ部はBufferを連結して multipart 本文を組む（テキスト版と違い文字列連結では壊れるため）。
 */
export async function uploadImageFile(
  folderId: string,
  name: string,
  mimeType: string,
  data: Buffer
): Promise<{ id: string; name: string }> {
  const token = await getWriteToken();
  const boundary = "b" + Date.now() + Math.random().toString(36).slice(2, 8);
  const meta = JSON.stringify({ name, parents: [folderId] });
  const pre = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    "utf-8"
  );
  const post = Buffer.from(`\r\n--${boundary}--`, "utf-8");
  const body = Buffer.concat([pre, data, post]);
  const res = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id,name&supportsAllDrives=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    }
  );
  if (!res.ok) throw new Error(`Drive 画像アップロード ${res.status}: ${await res.text()}`);
  return (await res.json()) as { id: string; name: string };
}

/** フォルダ内のテキストファイルを name で読む。無ければ null。 */
export async function readTextFileByName(folderId: string, name: string): Promise<string | null> {
  const token = await getWriteToken();
  const id = await findChildByName(folderId, name);
  if (!id) return null;
  const res = await fetch(`${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Drive files.get(media) ${res.status}: ${await res.text()}`);
  return res.text();
}

// --- 版管理（report-app が _ai/reports/<folder_id>/v*.json を append-only で書く・正本アーキ §5） ---

/** ファイル/フォルダの親 id を返す（複数親は先頭・無ければ null）。 */
export async function getParentId(fileId: string): Promise<string | null> {
  const token = await getWriteToken();
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Drive files.get(parents) ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { parents?: string[] };
  return json.parents?.[0] ?? null;
}

/**
 * 写真サブフォルダ（folder_id）に対応する版ディレクトリを解決する。
 * 配置＝**親案件フォルダ**の `_ai/reports/<folder_id>/`（_ai は digest と共用・案件単位）。
 * 親が見えない場合は写真サブフォルダ自身を基点にフォールバック。
 * @param create true=無ければ作る（保存時）／false=作らず無ければ null（一覧・ロールバック時）
 */
export async function resolveReportVersionsDir(
  photoFolderId: string,
  create: boolean
): Promise<string | null> {
  const parent = (await getParentId(photoFolderId)) ?? photoFolderId;
  if (create) {
    const ai = await ensureSubfolder(parent, AI_FOLDER_NAME);
    const reports = await ensureSubfolder(ai, "reports");
    return ensureSubfolder(reports, photoFolderId);
  }
  const ai = await findSubfolder(parent, AI_FOLDER_NAME);
  if (!ai) return null;
  const reports = await findSubfolder(ai, "reports");
  if (!reports) return null;
  return findSubfolder(reports, photoFolderId);
}

export type DriveFileEntry = {
  id: string;
  name: string;
  modifiedTime?: string;
  description?: string;
  appProperties?: Record<string, string>;
};

/** 版ディレクトリ内の全ファイル（id/name/modifiedTime/description/appProperties）を返す（版判定は呼び出し側）。 */
export async function listFolderFiles(folderId: string): Promise<DriveFileEntry[]> {
  const token = await getWriteToken();
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,modifiedTime,description,appProperties)",
    pageSize: "1000",
    orderBy: "name",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true"
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Drive files.list ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { files?: DriveFileEntry[] };
  return json.files ?? [];
}

/**
 * テキストファイルを **新規作成のみ**（upsert しない＝既存を上書きしない）。fileId を返す。
 * 版は append-only で不変にするため、保存は常に新ファイル名で create する。
 * `description`＝版名ラベル、`appProperties`＝アプリ私有メタ（作成者など）。いずれも Drive メタデータで
 * 報告内容（本文）は触らない。
 */
export async function createTextFile(
  folderId: string,
  name: string,
  content: string,
  opts: { mimeType?: string; description?: string; appProperties?: Record<string, string> } = {}
): Promise<string> {
  const token = await getWriteToken();
  const mimeType = opts.mimeType ?? "application/json";
  const meta: Record<string, unknown> = { name, parents: [folderId] };
  if (opts.description) meta.description = opts.description;
  if (opts.appProperties) meta.appProperties = opts.appProperties;
  const boundary = "b" + Date.now();
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;
  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  if (!res.ok) throw new Error(`Drive ファイル作成 ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

/** fileId 指定でテキスト内容を読む。 */
export async function readTextFileById(fileId: string): Promise<string> {
  const token = await getWriteToken();
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Drive files.get(media) ${res.status}: ${await res.text()}`);
  return res.text();
}

/** ファイルの description（版名ラベル）を更新する。本文（報告内容）は触らない＝不変性を保つ。 */
export async function setFileDescription(fileId: string, description: string): Promise<void> {
  const token = await getWriteToken();
  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=id&supportsAllDrives=true`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ description })
  });
  if (!res.ok) throw new Error(`Drive description更新 ${res.status}: ${await res.text()}`);
}

/** ファイルをゴミ箱へ（trashed=true・復元可）。物理削除はしない。 */
export async function trashFileById(fileId: string): Promise<void> {
  const token = await getWriteToken();
  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=id&supportsAllDrives=true`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true })
  });
  if (!res.ok) throw new Error(`Drive ゴミ箱移動 ${res.status}: ${await res.text()}`);
}
