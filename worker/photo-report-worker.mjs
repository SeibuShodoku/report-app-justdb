/**
 * 写真報告書 AI ワーカー（VM 常駐・フェーズ2 / 方式Y）。
 *
 * 流れ（正本アーキ: docs/architecture/slack-photo-report-architecture.md / 実装計画: docs/spec/slack-photo-report-impl-plan.md §2）:
 *   1. Supabase `photo_report_jobs` の queued を1件 claim（processing 化）
 *   2. **Drive を直接読む**（mgmt-strat の OAuth refresh token・drive.readonly）。
 *      ＝案件フォルダ群は mgmt-strat 所有ツリー配下なので、他者所有の写真も継承で読める。
 *   3. **VM 上の Claude Code をヘッドレス起動**して report.json を書かせる（Team サブスク認証・APIキー不要）
 *   4. report.json を検証（zod）し `photo_reports` に upsert、ジョブを done に
 *   5. 失敗は error＋attempts++ で記録、ポーリング継続
 *
 * 方式Yの経緯: Cloud Run 直結IAP がヘッドレス用 audience(client_id) を露出しないため、
 *   worker は IAP 越しのプロキシではなく Drive を直読みする。IAP はブラウザ閲覧の保護として維持。
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
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? "300000");
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

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
  headerSummary: z.string().max(2000).optional(),
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

function buildPrompt(ctx, docFileNames, hasDigest) {
  const docLine = hasDigest
    ? "このディレクトリの **case-digest.md** に案件の時系列ダイジェスト（引き合い・調査・見積・経緯の要約）があります。**まずそれを読み、実際の作業内容（対象生物・対策の種類）を正確に把握**してから写真を説明してください。"
    : docFileNames.length
      ? `このディレクトリには現場写真(画像)に加え、案件書類のPDF（${docFileNames.join(" / ")}）があります。**まず書類を読み、実際の作業内容（対象生物・対策の種類など）を正確に把握**してから写真を説明してください。`
      : "案件書類は無いので、フォルダ名と写真から判断してください。";
  return [
    "このディレクトリにある画像は、害虫防除（駆除）作業の現場写真です。これから写真報告書の下書きを作ります。",
    docLine,
    `参考フォルダ名: 親=「${ctx.parentName}」 / 当該=「${ctx.folderName}」。`,
    "**写真だけで対象生物や作業を断定しない**こと（書類・フォルダ名の根拠を優先）。不明な点は無理に決めつけない。",
    "各写真に、日本語で**短い見出し(heading・全角20字程度)**と、**簡潔な所見(annotationNote・1〜2文/全角120字程度)**を付けてください。冗長にしない。",
    "全体の要約(headerSummary・3文程度)も作成。写真は意味の通る順に並べ替えてよい。",
    "出力は **このディレクトリに report.json を1つ書き出す**こと。形式は厳密に次のJSONのみ:",
    '{ "headerSummary": "…", "photoItems": [ { "fileId": "<画像ファイル名から拡張子を除いた部分>", "heading": "…", "annotationNote": "…" } ] }',
    "fileId は各**画像**ファイル名の拡張子を除いた部分（例 1AbC.jpg → 1AbC）。case-digest.md / context-*.pdf は文脈用で報告対象ではない。JSON以外の文章は report.json に書かないこと。"
  ].join("\n");
}

/** VM の Claude Code をヘッドレス起動して report.json を書かせる。stdout/stderr を返す。 */
function runClaude(dir, prompt) {
  return new Promise((resolve, reject) => {
    // 権限プロンプトで止まらないようヘッドレス用フラグ。
    const args = ["-p", prompt, "--permission-mode", "acceptEdits"];
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

    const { stdout } = await runClaude(dir, buildPrompt(ctx, docNames, !!digest));

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
    await upsertReport(job.folder_id, job.case_id, reportJson);
    await finishJob(job.id, { status: "done", error: null });
    console.log(`[done] job=${job.id} folder=${job.folder_id} photos=${images.length} digest=${digest ? "yes" : "no"} docs=${docNames.length} items=${reportJson.photoItems.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJob(job.id, { status: "error", error: message.slice(0, 1000) });
    console.error(`[error] job=${job.id}: ${message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  console.log(`photo-report-worker(方式Y/Drive直読み) 起動。interval=${POLL_INTERVAL_MS}ms`);
  for (;;) {
    try {
      const job = await claimJob();
      if (job) await processJob(job);
      else await sleep(POLL_INTERVAL_MS);
    } catch (e) {
      console.error("[loop] ", e instanceof Error ? e.message : e);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

loop();
