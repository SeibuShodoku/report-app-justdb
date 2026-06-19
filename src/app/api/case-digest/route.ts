import {
  AI_FOLDER_NAME,
  driveWriteConfigured,
  ensureSubfolder,
  findSubfolder,
  readTextFileByName,
  upsertTextFile
} from "@/lib/drive-write";
import { DIGEST_FILE, SLACK_HISTORY_FILE, appendSlackHistory } from "@/lib/case-digest";
import { caseDigestWriteSchema } from "@/schemas/case-digest";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

// node:crypto / ストリームを使うため Node ランタイム固定。
export const runtime = "nodejs";

/**
 * 案件ダイジェスト「口」。**書き込みはサーバー間のみ**（x-proxy-secret 必須）。
 * POST: コアダイジェスト md を AI専用フォルダに upsert（＋ slackSummary があれば履歴へ追記）。
 * GET ?folderId=: 保存済みコアダイジェスト md を返す（無ければ404）。
 */
export async function POST(request: Request) {
  if (!driveWriteConfigured()) {
    return Response.json({ error: "Drive書込未設定（GOOGLE_CLIENT_ID/SECRET＋RW or DRIVE refresh token）" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON ボディが不正です。" }, { status: 400 });
  }
  const parsed = caseDigestWriteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "入力スキーマ不一致", detail: parsed.error.issues.slice(0, 3) }, { status: 400 });
  }
  const { caseId, driveFolderId, coreMarkdown, slackSummary } = parsed.data;

  // 書き込みはサーバー間のみ（ブラウザトークン不可）。
  const auth = authorizeFolderAccess(request, driveFolderId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.mode !== "server") {
    return Response.json({ error: "書き込みは x-proxy-secret（サーバー間）のみ許可。" }, { status: 403 });
  }

  try {
    const aiFolderId = await ensureSubfolder(driveFolderId, AI_FOLDER_NAME);
    const digestFileId = await upsertTextFile(aiFolderId, DIGEST_FILE, coreMarkdown);
    let historyFileId: string | undefined;
    if (slackSummary && slackSummary.trim()) {
      const existing = await readTextFileByName(aiFolderId, SLACK_HISTORY_FILE);
      const next = appendSlackHistory(existing, slackSummary, new Date().toISOString());
      historyFileId = await upsertTextFile(aiFolderId, SLACK_HISTORY_FILE, next);
    }
    return Response.json({ ok: true, caseId, aiFolderId, digestFileId, historyFileId });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "ダイジェスト保存に失敗しました。" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  if (!driveWriteConfigured()) {
    return Response.json({ error: "Drive書込未設定" }, { status: 503 });
  }
  const folderId = new URL(request.url).searchParams.get("folderId")?.trim();
  if (!folderId) return Response.json({ error: "folderId が必要です。" }, { status: 400 });

  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.mode !== "server") {
    return Response.json({ error: "サーバー間（x-proxy-secret）のみ許可。" }, { status: 403 });
  }

  try {
    const aiFolderId = await findSubfolder(folderId, AI_FOLDER_NAME);
    if (!aiFolderId) return Response.json({ error: "AI専用フォルダがありません。" }, { status: 404 });
    const markdown = await readTextFileByName(aiFolderId, DIGEST_FILE);
    if (markdown === null) return Response.json({ error: "digest.md がありません。" }, { status: 404 });
    return Response.json({ folderId, aiFolderId, markdown });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "取得に失敗しました。" },
      { status: 500 }
    );
  }
}
