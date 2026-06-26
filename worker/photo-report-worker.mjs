/**
 * AI ワーカー（VM 常駐・方式Y）。2つのジョブ型を1プロセスで捌く（D-DIGEST）。
 *
 * 正本アーキ: docs/architecture/slack-photo-report-architecture.md / 実装計画 §2 / 中央契約 contracts/case-digest/
 *
 * (1) 写真報告 `photo_report_jobs`:
 *   queued を claim → **Drive 直読み**で写真＋文脈(_ai/digest.md or PDF) → Claude Code(headless) で report.json
 *   → zod 検証 → `photo_reports` に upsert → done。
 * (2) 案件ダイジェスト `case_digest_jobs`（D-DIGEST / Phase D1→D2 統一正本モデル）:
 *   GAS が投入（構造化Slack増分＋前回備考）→ GD書類を既読索引で増分読み＋増分を畳み込み Claude で生成
 *   → **_ai/digest.md を Drive に直書き**（重要情報＋経緯＋既読索引／既読docs・吸収済tsの2カーソル同居）
 *   ＋ slack-summary-history.md 追記 → **固定的重要情報カードを job.result_summary**・吸収済tsを absorbed_ts へ
 *   → 生Slack(slack_delta)を破棄(null) → done。GAS は done をポーリングして備考を chat.update。
 *
 * Drive 認証＝mgmt-strat の OAuth refresh token。**drive（RW）**：写真/書類の読みに加え、
 *   digest 生成物（AI所有・人非接触）の `_ai/` 直書きに使う。案件群は mgmt-strat 所有ツリー配下なので継承で読める。
 *   ※版スナップショット（人が著者・append-only）の書き手は引き続き report-app「口」一本（写真側の原則は不変）。
 * 方式Yの経緯: Cloud Run 直結IAP がプログラム的 audience を受けないため（実測確定）、worker は IAP を越えず Drive 直アクセス。
 *
 * 実行（VM）: 必要 env を入れて `node worker/photo-report-worker.mjs`（詳細は worker/README.md）。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// --- 設定（env） ---
const SUPABASE_URL = req("SUPABASE_URL");
const SUPABASE_KEY = req("SUPABASE_SERVICE_ROLE_KEY");
const CLIENT_ID = req("GOOGLE_CLIENT_ID");
const CLIENT_SECRET = req("GOOGLE_CLIENT_SECRET");
const REFRESH_TOKEN = req("GOOGLE_DRIVE_REFRESH_TOKEN");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "15000");
const MAX_PHOTOS = Number(process.env.MAX_PHOTOS ?? "60"); // 1回の生成に渡す写真上限（サブスク消費の暴発防止）
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? "8"); // 試行上限。到達ジョブは Claude を回さず error 確定（暴走防止）
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? "300000");
// 写真報告＋ダイジェスト共通のモデル/エフォート（per-run指定）。既定= Opus 4.8 / medium。
// 文脈(digest/版履歴)が育つほど深い思考は不要、の方針。env で上書き可。effort= low/medium/high/xhigh/max。
const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";
const CLAUDE_EFFORT = process.env.CLAUDE_EFFORT ?? "medium";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3"; // ダイジェスト直書き（media/multipart）用

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} が未設定です。`);
  return v;
}

// --- report.json の検証スキーマ（src/schemas/photo-report.ts のミラー） ---
// annotations（赤丸など重ね描き）は人が WEB で付ける後フェーズの項目。AI は出力しないが、
// 版互換のためスキーマ上は予約し、欠落時は空配列に正規化する（既定 []）。
const annotationSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["circle", "rect", "arrow", "line", "freehand", "text", "stamp"]),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(4096).default([]),
  color: z.string().max(32).optional(),
  strokeWidth: z.number().min(0).max(64).optional(),
  text: z.string().max(500).optional(),
  asset: z.string().max(120).optional()
});
const reportJsonSchema = z.object({
  coverFileId: z.string().max(200).optional(), // 表紙にする写真の fileId（AIが代表1枚を選ぶ・不正/未指定は編集面が先頭にフォールバック）
  headerSummary: z.string().max(2000).optional(),
  workItems: z.array(z.string().max(300)).max(50).default([]), // 施工内容/調査内容（最終ページ）
  photoItems: z
    .array(
      z.object({
        fileId: z.string().min(1),
        heading: z.string().max(80).optional(),
        annotationNote: z.string().max(500).optional(),
        annotations: z.array(annotationSchema).max(200).default([])
      })
    )
    .min(1)
});

// --- Drive（直読み・mgmt-strat OAuth refresh token） ---
let cachedToken = null;
async function getDriveToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.value;
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  if (!res.ok) throw new Error(`Drive token更新失敗 ${res.status}: ${await res.text()}`);
  const j = await res.json();
  cachedToken = { value: j.access_token, expiresAt: now + j.expires_in };
  return j.access_token;
}

async function listImages(folderId) {
  const token = await getDriveToken();
  const images = [];
  let pageToken;
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and mimeType contains 'image/' and trashed = false`;
  do {
    const params = new URLSearchParams({
      q,
      fields: "nextPageToken, files(id, name, mimeType)",
      orderBy: "createdTime",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Drive files.list ${res.status}: ${await res.text()}`);
    const j = await res.json();
    for (const f of j.files ?? []) images.push({ fileId: f.id, name: f.name, mimeType: f.mimeType });
    pageToken = j.nextPageToken;
  } while (pageToken);
  return images;
}

function extFor(image) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(image.name ?? "");
  if (m) return m[1].toLowerCase();
  return image.mimeType === "image/png" ? "png" : "jpg";
}

async function downloadPhoto(image, dir) {
  const token = await getDriveToken();
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(image.fileId)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive files.get(media) ${image.fileId} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // ファイル名 = fileId.ext にして、Claude が fileId をそのまま参照できるようにする。
  writeFileSync(join(dir, `${image.fileId}.${extFor(image)}`), buf);
}

// --- 案件の文脈（フォルダ名＋同フォルダ/親フォルダの主要PDF） ---
const MAX_CONTEXT_DOCS = Number(process.env.MAX_CONTEXT_DOCS ?? "5");
const AI_FOLDER_NAME = process.env.AI_WORKSPACE_FOLDER_NAME ?? "_ai"; // 「口」(report-app)と同じAI専用フォルダ名
// 文脈に有用なPDF（調査報告/見積/管理/点検/カルテ）を優先、請求書・地図は除外。
const DOC_INCLUDE = /調査|報告|見積|管理|点検|カルテ|仕様|作業/;
const DOC_EXCLUDE = /請求|navitime|map|route|invoice/i;

async function getFileMeta(id) {
  const token = await getDriveToken();
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(id)}?fields=id,name,parents&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Drive files.get(meta) ${id} ${res.status}`);
  return res.json();
}

async function listPdfs(folderId) {
  const token = await getDriveToken();
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and mimeType='application/pdf' and trashed = false`;
  const params = new URLSearchParams({
    q,
    fields: "files(id, name)",
    pageSize: "200",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true"
  });
  const res = await fetch(`${DRIVE_API}/files?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive files.list(pdf) ${res.status}`);
  return (await res.json()).files ?? [];
}

/** フォルダ名・親フォルダ名と、文脈に使うPDF群を集める。 */
async function gatherContext(folderId) {
  const self = await getFileMeta(folderId);
  const parentId = self.parents?.[0];
  const parent = parentId ? await getFileMeta(parentId) : null;
  const pdfs = [...(await listPdfs(folderId)), ...(parentId ? await listPdfs(parentId) : [])];
  const picked = pdfs
    .filter((f) => !DOC_EXCLUDE.test(f.name))
    .sort((a, b) => (DOC_INCLUDE.test(b.name) ? 1 : 0) - (DOC_INCLUDE.test(a.name) ? 1 : 0))
    .slice(0, MAX_CONTEXT_DOCS);
  return { folderName: self.name, parentName: parent?.name ?? "", docs: picked };
}

function sanitize(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

async function downloadDoc(file, dir, idx) {
  const token = await getDriveToken();
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null; // 文脈書類は欠けても致命的でない
  writeFileSync(join(dir, `context-${idx}-${sanitize(file.name)}`), Buffer.from(await res.arrayBuffer()));
  return file.name;
}

// --- 案件ダイジェスト(_ai/digest.md)の読み取り（readonlyでOK・「口」が書いたものを読む） ---
async function getParentId(folderId) {
  const m = await getFileMeta(folderId);
  return m.parents?.[0] ?? null;
}
async function findSubfolderRO(parentId, name) {
  const token = await getDriveToken();
  const q = `'${parentId.replace(/'/g, "\\'")}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const r = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return (await r.json()).files?.[0]?.id ?? null;
}
async function readTextByNameRO(folderId, name) {
  const token = await getDriveToken();
  const q = `'${folderId.replace(/'/g, "\\'")}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  const r = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  const id = (await r.json()).files?.[0]?.id;
  if (!id) return null;
  const m = await fetch(`${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  return m.ok ? m.text() : null;
}
/** _ai/digest.md を folder_id → 親 の順に探す（案件フォルダ＝写真フォルダ or その親）。無ければ null。 */
async function readCaseDigest(folderId) {
  const candidates = [folderId, await getParentId(folderId)];
  for (const fid of candidates) {
    if (!fid) continue;
    const ai = await findSubfolderRO(fid, AI_FOLDER_NAME);
    if (!ai) continue;
    const md = await readTextByNameRO(ai, "digest.md");
    if (md && md.trim()) return md;
  }
  return null;
}

// --- Drive 書込み（ダイジェスト直書き・RW token / Option A） ---
// digest.md・slack-summary-history.md は AI 所有の生成物。report-app「口」と同じ _ai/ に同じ形式で書く
//（口は閲覧/他consumer用に存置。書き手が二者になるがファイルは upsert で冪等）。
async function findChildId(parentId, name, mimeType) {
  const token = await getDriveToken();
  let q = `'${parentId.replace(/'/g, "\\'")}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (mimeType) q += ` and mimeType = '${mimeType}'`;
  const r = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Drive files.list(child) ${r.status}`);
  return (await r.json()).files?.[0]?.id ?? null;
}
async function ensureSubfolderRW(parentId, name) {
  const existing = await findChildId(parentId, name, "application/vnd.google-apps.folder");
  if (existing) return existing;
  const token = await getDriveToken();
  const res = await fetch(`${DRIVE_API}/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] })
  });
  if (!res.ok) throw new Error(`Drive folder作成 ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}
/** 既存なら media 更新、無ければ multipart 作成。fileId を返す。 */
async function upsertTextFileRW(folderId, name, content, mimeType = "text/markdown") {
  const token = await getDriveToken();
  const existing = await findChildId(folderId, name);
  if (existing) {
    const res = await fetch(`${UPLOAD_API}/files/${existing}?uploadType=media&supportsAllDrives=true`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType },
      body: content
    });
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
  return (await res.json()).id;
}
/** Slack要約履歴の追記（report-app src/lib/case-digest.ts のミラー）。 */
function appendSlackHistory(existing, entry, isoTime) {
  const head = "# Slack要約 履歴（AI自動・編集禁止）\n";
  const block = `\n---\n## ${isoTime}\n\n${entry.trim()}\n`;
  if (!existing || !existing.trim()) return head + block;
  return existing.replace(/\s+$/, "") + "\n" + block;
}

// --- ダイジェスト生成の入出力（D2：統一正本モデル） ---
const DIGEST_FILE = "digest.md";
const SLACK_HISTORY_FILE = "slack-summary-history.md";
const READ_MARKER = /<!--\s*digest-read-doc-ids:\s*([^>]*)-->/i;       // digest.md 末尾：既読書類IDカーソル
const ABSORBED_TS_MARKER = /<!--\s*slack-absorbed-ts:\s*([^>]*)-->/i;  // digest.md 末尾：吸収済 Slack ts カーソル
const DELTA_TS_MARKER = /<!--\s*delta-through-ts:\s*([^>]*)-->/i;       // slack_delta 末尾：GAS が付すこの増分の最終 ts
const MAX_DIGEST_DOCS = Number(process.env.MAX_DIGEST_DOCS ?? "6"); // 1回に新規で読む書類上限（既読は再読しない）

// Claude が書き出すダイジェスト生成物。
const digestOutSchema = z.object({
  digestMarkdown: z.string().min(1).max(20000),  // _ai/digest.md 本文（重要情報＋経緯＋既読索引）
  importantInfoCard: z.string().min(1).max(2000) // トピック備考用の「固定的な重要情報カード」（GAS が反映＝result_summary）
});

/** digest.md 末尾マーカーから既読 docId 集合を取り出す。 */
function parseReadDocIds(md) {
  if (!md) return [];
  const m = md.match(READ_MARKER);
  if (!m) return [];
  return m[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}
/** digest.md 末尾マーカーから吸収済 Slack ts を取り出す（無ければ null）。 */
function parseSlackAbsorbedTs(md) {
  if (!md) return null;
  const m = md.match(ABSORBED_TS_MARKER);
  return m && m[1].trim() ? m[1].trim() : null;
}
/** slack_delta 末尾の delta-through-ts（GAS が付すこの増分の最終 ts）を取り出す。 */
function parseDeltaThroughTs(delta) {
  if (!delta) return null;
  const m = delta.match(DELTA_TS_MARKER);
  return m && m[1].trim() ? m[1].trim() : null;
}
/** digest.md 末尾に2カーソル（既読docs・吸収済ts）を載せ直す。本文側の索引文は Claude が書く。 */
function withTailMarkers(md, readIds, absorbedTs) {
  const uniq = [...new Set(readIds)].filter(Boolean);
  const body = md.replace(READ_MARKER, "").replace(ABSORBED_TS_MARKER, "").replace(/\s+$/, "");
  const lines = [`<!-- digest-read-doc-ids: ${uniq.join(",")} -->`];
  if (absorbedTs) lines.push(`<!-- slack-absorbed-ts: ${absorbedTs} -->`);
  return `${body}\n\n${lines.join("\n")}\n`;
}

// --- Supabase REST ---
async function sb(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function claimJob() {
  const queued = await sb("GET", "photo_report_jobs?status=eq.queued&order=created_at.asc&limit=1&select=*");
  if (!queued || queued.length === 0) return null;
  const job = queued[0];
  const claimed = await sb(
    "PATCH",
    `photo_report_jobs?id=eq.${job.id}&status=eq.queued`,
    { status: "processing", attempts: (job.attempts ?? 0) + 1, updated_at: new Date().toISOString() },
    { Prefer: "return=representation" }
  );
  if (!claimed || claimed.length === 0) return null;
  return claimed[0];
}

async function finishJob(id, patch) {
  await sb("PATCH", `photo_report_jobs?id=eq.${id}`, { ...patch, updated_at: new Date().toISOString() });
}

async function upsertReport(folderId, caseId, reportJson) {
  await sb(
    "POST",
    "photo_reports",
    { folder_id: folderId, case_id: caseId ?? null, report_json: reportJson, source: "ai", generated_at: new Date().toISOString() },
    { Prefer: "resolution=merge-duplicates,return=minimal" }
  );
}

/** フォルダの生成設定を読む（photo_report_settings）。無ければ null（既定で生成）。 */
async function getSettings(folderId) {
  try {
    const rows = await sb(
      "GET",
      `photo_report_settings?folder_id=eq.${encodeURIComponent(folderId)}&select=*&limit=1`
    );
    return rows && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

/** 設定 → Claude プロンプトの指示行（日本語）。s は snake_case 行 or null。 */
function settingsLines(s) {
  const type = s?.report_type === "survey" ? "survey" : "construction";
  const tone = s?.tone_politeness === "plain" ? "plain" : "desu_masu";
  const resp = s?.response_mode === "complaint" ? "complaint" : "normal";
  const weight = s?.proposal_weight === "strong" ? "strong" : s?.proposal_weight === "light" ? "light" : "normal";
  const client = s?.client_type === "individual" ? "individual" : "corporate";
  const kind = type === "survey" ? "調査" : "施工";
  const lines = [];
  lines.push(
    type === "survey"
      ? "これは【調査報告書】です。現地調査で確認した状況・所見・被害/リスクを中心に記述してください。"
      : "これは【施工報告書】です。実施した施工内容（処理した場所・薬剤・工法）を中心に記述してください。"
  );
  lines.push(
    tone === "plain"
      ? "文体は【言い切り調】：簡潔に（〜した／体言止め可）。"
      : "文体は【ですます調】：丁寧に（〜しました／〜します）。"
  );
  if (resp === "complaint") {
    lines.push("【クレーム対応】の案件です。誠実かつ丁寧に、事実と対応を明確にし、相手の不安に配慮した表現にしてください。");
  }
  lines.push(
    weight === "strong"
      ? "まとめ(headerSummary)では、追加対策・再施工/メンテナンスの必要性を【しっかり】提案的に記述してください。"
      : weight === "light"
        ? "提案は【軽め】に、事実報告を主にしてください。"
        : "提案は【普通】程度にとどめてください。"
  );
  lines.push(
    client === "individual"
      ? "相手は【個人のお客様】です。専門用語はかみ砕き、分かりやすく丁寧に書いてください。"
      : "相手は【法人】です。簡潔・実務的に書いてください。"
  );
  return { lines, kind };
}

function buildPrompt(ctx, docFileNames, hasDigest, settings) {
  const { lines: setLines, kind } = settingsLines(settings);
  const docLine = hasDigest
    ? "このディレクトリの **case-digest.md** に案件の時系列ダイジェスト（引き合い・調査・見積・経緯の要約）があります。**まずそれを読み、実際の作業内容（対象生物・対策の種類）を正確に把握**してから写真を説明してください。"
    : docFileNames.length
      ? `このディレクトリには現場写真(画像)に加え、案件書類のPDF（${docFileNames.join(" / ")}）があります。**まず書類を読み、実際の作業内容（対象生物・対策の種類など）を正確に把握**してから写真を説明してください。`
      : "案件書類は無いので、フォルダ名と写真から判断してください。";
  return [
    `このディレクトリにある画像は、害虫防除（${kind}）の現場写真です。これから写真報告書の下書きを作ります。`,
    docLine,
    `参考フォルダ名: 親=「${ctx.parentName}」 / 当該=「${ctx.folderName}」。`,
    "【報告書の方針】",
    ...setLines,
    "**写真だけで対象生物や作業を断定しない**こと（書類・フォルダ名の根拠を優先）。不明な点は無理に決めつけない。",
    "【書き方】",
    "・各写真の見出し(heading)は **全角20字以内** の簡潔な作業名（例『103号室の風呂場下の木部を穿孔処理』『大引きに薬剤を散布処理』『使用薬剤』）。",
    "・所見(annotationNote)は基本不要（空でよい）。見出しで足りる。",
    "・写真は意味の通る順（部屋ごと・工程順）に並べ替えてよい。",
    "・表紙(coverFileId)に、案件や現場・作業全体が最も伝わる代表的な1枚（建物外観・現場全景・対象がはっきり写った象徴的な写真）の fileId を選ぶ。クレーム/被害が主題ならその被害が分かる1枚でもよい。**coverFileId は必ず photoItems のどれかの fileId と一致**させること。",
    `・headerSummary は${kind}概要（まとめ）。上記の文体・トーンで2〜3文。`,
    `・workItems は実施した${kind}内容を **数項目に集約** した配列（各項目1文・場所＋処理を簡潔に。例『101号室・102号室・103号室の床下に木部剤・土壌剤を散布処理』）。最終ページの一覧に使う。`,
    "出力は **このディレクトリに report.json を1つ書き出す**こと。形式は厳密に次のJSONのみ:",
    '{ "coverFileId": "<代表写真のfileId>", "headerSummary": "…", "workItems": ["…","…"], "photoItems": [ { "fileId": "<画像ファイル名から拡張子を除いた部分>", "heading": "…" } ] }',
    "fileId は各**画像**ファイル名の拡張子を除いた部分（例 1AbC.jpg → 1AbC）。case-digest.md / context-*.pdf は文脈用で報告対象ではない。JSON以外の文章は report.json に書かないこと。"
  ].join("\n");
}

/** VM の Claude Code をヘッドレス起動して report.json を書かせる。stdout/stderr を返す。 */
function runClaude(dir, prompt) {
  return new Promise((resolve, reject) => {
    // 権限プロンプトで止まらないようヘッドレス用フラグ＋モデル/エフォート（per-run）。
    const args = ["-p", prompt, "--permission-mode", "acceptEdits", "--model", CLAUDE_MODEL, "--effort", CLAUDE_EFFORT];
    const child = spawn(CLAUDE_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude Code がタイムアウトしました。"));
    }, CLAUDE_TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Claude Code 異常終了 code=${code}: ${stderr.slice(0, 500)}`));
      else resolve({ stdout, stderr });
    });
  });
}

/** claude の stdout から JSON オブジェクトを取り出す（ファイル未生成時のフォールバック/診断用）。 */
function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) return fence[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

async function processJob(job) {
  // 試行上限ガード：claim 時に attempts は加算済み。上限超過は Claude を回さず error 確定
  // （恒久的に失敗するジョブが再投入で延々とサブスクを焼くのを防ぐ）。
  if ((job.attempts ?? 0) > MAX_ATTEMPTS) {
    await finishJob(job.id, {
      status: "error",
      error: `再試行上限(${MAX_ATTEMPTS}回)に到達しました。写真と案件書類を確認してください。`
    });
    console.warn(`[skip] job=${job.id} attempts=${job.attempts} > MAX_ATTEMPTS=${MAX_ATTEMPTS}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), `pr-${job.id}-`));
  try {
    const images = (await listImages(job.folder_id)).slice(0, MAX_PHOTOS);
    if (images.length === 0) throw new Error("フォルダに写真がありません。");
    for (const img of images) await downloadPhoto(img, dir);

    // 案件文脈（フォルダ名＋主要PDF）を集めて同梱
    const ctx = await gatherContext(job.folder_id);
    // 案件ダイジェスト(_ai/digest.md)があればそれを文脈に（PDF選読は省略）。無ければ従来のPDF方式。
    const digest = await readCaseDigest(job.folder_id);
    const docNames = [];
    if (digest) {
      writeFileSync(join(dir, "case-digest.md"), digest);
    } else {
      for (let i = 0; i < ctx.docs.length; i++) {
        const name = await downloadDoc(ctx.docs[i], dir, i);
        if (name) docNames.push(name);
      }
    }

    const settings = await getSettings(job.folder_id);
    const { stdout } = await runClaude(dir, buildPrompt(ctx, docNames, !!digest, settings));

    // 通常は claude が report.json を書く。書かれていない場合:
    //  ・stdout に JSON があればそれを採用（claude がファイルでなく出力に返した時の保険）
    //  ・無ければ claude の応答（拒否理由など）をエラーに含める（不透明な ENOENT を避ける）
    const reportPath = join(dir, "report.json");
    let raw;
    if (existsSync(reportPath)) {
      raw = readFileSync(reportPath, "utf-8");
    } else {
      const fromStdout = extractJson(stdout);
      if (fromStdout) {
        raw = fromStdout;
        console.warn(`[warn] job=${job.id}: report.json 未生成→stdoutのJSONを採用`);
      } else {
        throw new Error(`report.json が生成されませんでした。claude応答: ${String(stdout).trim().slice(0, 600)}`);
      }
    }
    const reportJson = reportJsonSchema.parse(JSON.parse(raw));
    // 表紙：AIが選んだ coverFileId が実在写真でなければ落とす（編集面が先頭にフォールバック）。
    if (reportJson.coverFileId && !reportJson.photoItems.some((p) => p.fileId === reportJson.coverFileId)) {
      delete reportJson.coverFileId;
    }
    await upsertReport(job.folder_id, job.case_id, reportJson);
    await finishJob(job.id, { status: "done", error: null });
    console.log(`[done] job=${job.id} folder=${job.folder_id} photos=${images.length} digest=${digest ? "yes" : "no"} docs=${docNames.length} items=${reportJson.photoItems.length} cover=${reportJson.coverFileId ? "ai" : "default"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJob(job.id, { status: "error", error: message.slice(0, 1000) });
    console.error(`[error] job=${job.id}: ${message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 案件ダイジェスト生成ジョブ（case_digest_jobs / D-DIGEST・Phase D1） ---
async function claimDigestJob() {
  const queued = await sb("GET", "case_digest_jobs?status=eq.queued&order=created_at.asc&limit=1&select=*");
  if (!queued || queued.length === 0) return null;
  const job = queued[0];
  const claimed = await sb(
    "PATCH",
    `case_digest_jobs?id=eq.${job.id}&status=eq.queued`,
    { status: "processing", attempts: (job.attempts ?? 0) + 1, updated_at: new Date().toISOString() },
    { Prefer: "return=representation" }
  );
  if (!claimed || claimed.length === 0) return null; // 競合で他に取られた
  return claimed[0];
}

async function finishDigestJob(id, patch) {
  await sb("PATCH", `case_digest_jobs?id=eq.${id}`, { ...patch, updated_at: new Date().toISOString() });
}

function buildDigestPrompt(ctx, prevDigest, newDocNames, hasDelta, hasPrevSummary) {
  return [
    `案件「${ctx.folderName}」の【案件ダイジェスト digest.md】を更新します。これは案件知識の正本（AI製・人非接触）で、写真報告など後段のAIと人が文脈把握に使います。`,
    prevDigest
      ? "このディレクトリの **prev-digest.md** が前回までのダイジェスト（正）。これを土台に増分だけ反映して更新（全部書き直さない・既存の重要情報は消さない）。"
      : "前回ダイジェストはありません。新規に作成してください。",
    newDocNames.length
      ? `未読の案件書類PDF（${newDocNames.join(" / ")}）を置きました。**一度読んだら既読**として要点を織り込んでください。`
      : "今回新規に読む書類はありません。",
    hasDelta
      ? "**slack-delta.txt** に前回以降のSlack増分があります（各行に[話者名]・時刻・完了スタンプ等の文脈付き）。発言者を取り違えず、文脈で読み、時系列に反映してください。末尾の `<!-- … -->` は機械用メタなので無視。"
      : "Slackの増分はありません。",
    hasPrevSummary ? "**prev-summary.txt** は前回のトピック備考（重要情報カード）です。連続性を保ってください。" : "",
    "",
    "【digest.md の構成（この4部・Markdown）】",
    "1) `# 案件ダイジェスト：<案件名>`",
    "2) `## 重要情報（固定）` — 後述の重要情報だけを箇条書き。恒久制約は更新が無くても残し続ける（消さない）。",
    "3) `## 経緯（時系列）` — 調査/依頼/懸念などの時系列メモ（機械文脈用・人はここを常読しない）。",
    "4) `## 既読書類索引` — 読んだ書類ごとに『名前（種別・日付）：要点1行』。",
    "",
    "【重要情報の定義】会話・資料にしか残らない定性情報だけを積み上げる台帳。",
    "拾う：①決定事項（方針・やる/やらない・経緯と理由）②連絡先/担当の会話上の補足③顧客の要望・制約（鍵/駐車/立入時間帯/ペット/アレルギー/NG/特記）④現地特記（建物・搬入・危険箇所・アクセス）⑤宿題・約束(TODO)＋期限＋担当⑥トラブル/クレームと対応・結論⑦前提を覆す変更。",
    "**拾わない（重要）：受注金額・見積・日程の確定/変更・受注/契約ステータス等、JUST.DB(台帳)やPCで引ける構造化データ。混ぜると重要度の質がぶれる。**",
    "・資料由来の恒久制約（例：初期PDFの『平日は電話NG』）は**ずっと保持**する。",
    "・完了スタンプ付きの宿題・連絡は『対応済み』と明記。前回と矛盾する新情報は上書き。",
    "",
    "【出力】このディレクトリに **digest-out.json を1つだけ**書き出すこと。形式は厳密に次のJSONのみ:",
    '{ "digestMarkdown": "(digest.md 全文・上記4部)", "importantInfoCard": "(トピック備考に出す固定的重要情報カード。『重要情報（固定）』を“要約を見て要約”で短く整えた箇条書き。時系列にしない・構造化データを入れない)" }',
    "JSON以外の文章はファイルに書かないこと。"
  ].filter(Boolean).join("\n");
}

async function processDigestJob(job) {
  if ((job.attempts ?? 0) > MAX_ATTEMPTS) {
    await finishDigestJob(job.id, { status: "error", error: `再試行上限(${MAX_ATTEMPTS}回)に到達しました。` });
    console.warn(`[digest skip] job=${job.id} attempts=${job.attempts} > ${MAX_ATTEMPTS}`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), `cd-${job.id}-`));
  try {
    const self = await getFileMeta(job.folder_id); // 案件フォルダ（_ai/ の親）
    const allPdfs = (await listPdfs(job.folder_id)).filter((f) => !DOC_EXCLUDE.test(f.name));
    const prevDigest = await readCaseDigest(job.folder_id);
    if (prevDigest) writeFileSync(join(dir, "prev-digest.md"), prevDigest);
    const readIds = parseReadDocIds(prevDigest);
    const prevAbsorbedTs = parseSlackAbsorbedTs(prevDigest); // 前回までに吸収した Slack ts（カーソル）
    // 未読のみ新規に読む（既読は再読しない＝トークン安定・D-DIGEST「欲張らない」）
    const newDocs = allPdfs.filter((f) => !readIds.includes(f.id)).slice(0, MAX_DIGEST_DOCS);
    const newDocNames = [];
    for (let i = 0; i < newDocs.length; i++) {
      const name = await downloadDoc(newDocs[i], dir, i);
      if (name) newDocNames.push(name);
    }
    const hasDelta = !!(job.slack_delta && job.slack_delta.trim());
    if (hasDelta) writeFileSync(join(dir, "slack-delta.txt"), job.slack_delta);
    // GAS がこの増分の最終 ts を slack_delta 末尾に付す。畳み込んだら吸収済 ts を前進（無ければ据置）。
    const deltaThroughTs = hasDelta ? parseDeltaThroughTs(job.slack_delta) : null;
    const newAbsorbedTs = deltaThroughTs || prevAbsorbedTs;
    const hasPrevSummary = !!(job.prev_summary && job.prev_summary.trim());
    if (hasPrevSummary) writeFileSync(join(dir, "prev-summary.txt"), job.prev_summary);

    const prompt = buildDigestPrompt({ folderName: self.name }, prevDigest, newDocNames, hasDelta, hasPrevSummary);
    const { stdout } = await runClaude(dir, prompt);

    const outPath = join(dir, "digest-out.json");
    let raw;
    if (existsSync(outPath)) {
      raw = readFileSync(outPath, "utf-8");
    } else {
      const fromStdout = extractJson(stdout);
      if (fromStdout) {
        raw = fromStdout;
        console.warn(`[warn] digest job=${job.id}: digest-out.json 未生成→stdoutのJSONを採用`);
      } else {
        throw new Error(`digest-out.json が生成されませんでした。claude応答: ${String(stdout).trim().slice(0, 600)}`);
      }
    }
    const out = digestOutSchema.parse(JSON.parse(raw));

    // コミット順序（クラッシュ安全・仕様 §4.1）：
    // (a) _ai/digest.md を直書き（2カーソル＝既読docs・吸収済ts を worker 側で確定して載せ直す）。
    const aiFolderId = await ensureSubfolderRW(job.folder_id, AI_FOLDER_NAME);
    const allReadIds = [...readIds, ...newDocs.map((f) => f.id)];
    const md = withTailMarkers(out.digestMarkdown, allReadIds, newAbsorbedTs);
    const digestFileId = await upsertTextFileRW(aiFolderId, DIGEST_FILE, md);
    // (b) Slack要約は時系列履歴へ追記（増分があった時のみ・トピックは上書きで消えるため md に残す）。
    if (hasDelta) {
      const existing = await readTextByNameRO(aiFolderId, SLACK_HISTORY_FILE);
      const next = appendSlackHistory(existing, out.importantInfoCard, new Date().toISOString());
      await upsertTextFileRW(aiFolderId, SLACK_HISTORY_FILE, next);
    }
    // (c) job を done に（重要情報カード=備考／吸収済ts／digest_file_id）。(d) 生Slackを破棄（短命・null）。
    await finishDigestJob(job.id, {
      status: "done",
      error: null,
      result_summary: out.importantInfoCard,
      digest_file_id: digestFileId,
      absorbed_ts: newAbsorbedTs,
      slack_delta: null
    });
    console.log(`[digest done] job=${job.id} case=${job.case_id} folder=${job.folder_id} newDocs=${newDocNames.length} delta=${hasDelta ? "yes" : "no"} absorbedTs=${newAbsorbedTs ?? "-"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishDigestJob(job.id, { status: "error", error: message.slice(0, 1000) });
    console.error(`[digest error] job=${job.id}: ${message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  console.log(`ai-worker(方式Y/Drive直読み・写真+ダイジェスト) 起動。interval=${POLL_INTERVAL_MS}ms model=${CLAUDE_MODEL} effort=${CLAUDE_EFFORT}`);
  for (;;) {
    try {
      // 写真報告を優先（人が待つUI起点）。無ければダイジェスト生成を1件。どちらも無ければ待つ。
      const photo = await claimJob();
      if (photo) { await processJob(photo); continue; }
      const digest = await claimDigestJob();
      if (digest) { await processDigestJob(digest); continue; }
      await sleep(POLL_INTERVAL_MS);
    } catch (e) {
      console.error("[loop] ", e instanceof Error ? e.message : e);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

loop();
