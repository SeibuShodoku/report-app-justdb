/**
 * 写真報告書 AI ワーカー（VM 常駐・フェーズ2）。
 *
 * 流れ（仕様: docs/spec/slack-photo-report.md / 実装計画 §2）:
 *   1. Supabase `photo_report_jobs` の queued を1件 claim（processing 化）
 *   2. report-app の画像プロキシ（/api/folder → /api/photo, x-proxy-secret）で写真を作業ディレクトリへDL
 *   3. **VM 上の Claude Code をヘッドレス起動**して report.json を書かせる（Team サブスク認証・APIキー不要）
 *   4. report.json を検証（zod）し `photo_reports` に upsert、ジョブを done に
 *   5. 失敗は error＋attempts++ で記録、ポーリング継続
 *
 * 実行（VM）: 必要 env を入れて `node worker/photo-report-worker.mjs`（詳細は worker/README.md）。
 * 注意: Google 資格情報は持たない（写真は必ずプロキシ経由）。Claude は必ず VM の Team サブスク認証で動かす（D-AIDATA）。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

// --- 設定（env） ---
const SUPABASE_URL = req("SUPABASE_URL");
const SUPABASE_KEY = req("SUPABASE_SERVICE_ROLE_KEY");
const REPORT_APP_BASE = req("REPORT_APP_BASE"); // 例: http://localhost:3000 / https://<vercel>
const PROXY_SECRET = req("DRIVE_PROXY_SERVER_SECRET");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "15000");
const MAX_PHOTOS = Number(process.env.MAX_PHOTOS ?? "60"); // 1回の生成に渡す写真上限（サブスク消費の暴発防止）
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? "300000");

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} が未設定です。`);
  return v;
}

// --- report.json の検証スキーマ（src/schemas/photo-report.ts のミラー。worker を素の node で動かすため再掲） ---
const reportJsonSchema = z.object({
  headerSummary: z.string().max(2000).optional(),
  photoItems: z
    .array(
      z.object({
        fileId: z.string().min(1),
        heading: z.string().max(80).optional(),
        annotationNote: z.string().max(500).optional()
      })
    )
    .min(1)
});

// --- Supabase REST 薄ラッパ ---
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
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** queued を1件 claim（status=eq.queued 条件付き更新で多重取得を防ぐ）。取れなければ null。 */
async function claimJob() {
  const queued = await sb(
    "GET",
    "photo_report_jobs?status=eq.queued&order=created_at.asc&limit=1&select=*"
  );
  if (!queued || queued.length === 0) return null;
  const job = queued[0];
  const claimed = await sb(
    "PATCH",
    `photo_report_jobs?id=eq.${job.id}&status=eq.queued`,
    { status: "processing", attempts: (job.attempts ?? 0) + 1, updated_at: new Date().toISOString() },
    { Prefer: "return=representation" }
  );
  if (!claimed || claimed.length === 0) return null; // 競合で他が取った
  return claimed[0];
}

async function finishJob(id, patch) {
  await sb("PATCH", `photo_report_jobs?id=eq.${id}`, {
    ...patch,
    updated_at: new Date().toISOString()
  });
}

async function upsertReport(folderId, caseId, reportJson) {
  await sb(
    "POST",
    "photo_reports",
    {
      folder_id: folderId,
      case_id: caseId ?? null,
      report_json: reportJson,
      source: "ai",
      generated_at: new Date().toISOString()
    },
    { Prefer: "resolution=merge-duplicates,return=minimal" }
  );
}

// --- 画像プロキシ ---
async function listImages(folderId) {
  const res = await fetch(
    `${REPORT_APP_BASE}/api/folder?folderId=${encodeURIComponent(folderId)}`,
    { headers: { "x-proxy-secret": PROXY_SECRET }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`/api/folder ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.images ?? [];
}

function extFor(image) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(image.name ?? "");
  if (m) return m[1].toLowerCase();
  return image.mimeType === "image/png" ? "png" : "jpg";
}

async function downloadPhoto(folderId, image, dir) {
  const res = await fetch(
    `${REPORT_APP_BASE}/api/photo?fileId=${encodeURIComponent(image.fileId)}&folderId=${encodeURIComponent(folderId)}`,
    { headers: { "x-proxy-secret": PROXY_SECRET }, cache: "no-store" }
  );
  if (!res.ok) throw new Error(`/api/photo ${image.fileId} ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // ファイル名 = fileId.ext にして、Claude が fileId をそのまま参照できるようにする。
  writeFileSync(join(dir, `${image.fileId}.${extFor(image)}`), buf);
}

const PROMPT = [
  "このディレクトリにある画像は、防除（害虫駆除）作業の現場写真です。",
  "各写真について、日本語で簡潔な見出し(heading, 80字以内)と、所見・指摘(annotationNote, 500字以内)を付けてください。",
  "全体の要約(headerSummary)も作ってください。写真は意味の通る順に並べ替えて構いません。",
  "出力は **このディレクトリに report.json というファイルを1つ書き出す**こと。形式は厳密に次の JSON のみ:",
  '{ "headerSummary": "…", "photoItems": [ { "fileId": "<ファイル名から拡張子を除いた部分>", "heading": "…", "annotationNote": "…" } ] }',
  "fileId は各画像ファイル名の拡張子を除いた部分です（例 1AbC.jpg → fileId=1AbC）。提供された画像だけを使い、JSON以外の文章は report.json に書かないこと。"
].join("\n");

/** VM の Claude Code をヘッドレス起動して report.json を書かせる。 */
function runClaude(dir) {
  return new Promise((resolve, reject) => {
    // 注意: 権限プロンプトで止まらないようヘッドレス用フラグを付ける。
    //   フラグは Claude Code のバージョンで差異があるため、VM で `claude --help` を見て M2 時に最終調整する。
    const args = ["-p", PROMPT, "--permission-mode", "acceptEdits"];
    const child = spawn(CLAUDE_BIN, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude Code がタイムアウトしました。"));
    }, CLAUDE_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Claude Code 異常終了 code=${code}: ${stderr.slice(0, 500)}`));
      else resolve();
    });
  });
}

async function processJob(job) {
  const dir = mkdtempSync(join(tmpdir(), `pr-${job.id}-`));
  try {
    const images = (await listImages(job.folder_id)).slice(0, MAX_PHOTOS);
    if (images.length === 0) throw new Error("フォルダに写真がありません。");
    for (const img of images) await downloadPhoto(job.folder_id, img, dir);

    await runClaude(dir);

    const raw = readFileSync(join(dir, "report.json"), "utf-8");
    const reportJson = reportJsonSchema.parse(JSON.parse(raw));

    await upsertReport(job.folder_id, job.case_id, reportJson);
    await finishJob(job.id, { status: "done", error: null });
    console.log(`[done] job=${job.id} folder=${job.folder_id} photos=${images.length} items=${reportJson.photoItems.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishJob(job.id, { status: "error", error: message.slice(0, 1000) });
    console.error(`[error] job=${job.id}: ${message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loop() {
  console.log(`photo-report-worker 起動。base=${REPORT_APP_BASE} interval=${POLL_INTERVAL_MS}ms`);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

loop();
