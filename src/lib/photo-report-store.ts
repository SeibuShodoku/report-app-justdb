/**
 * 写真報告書の保存・版管理オーケストレーション（サーバー専用）。
 *
 * 保存 = Drive `_ai/reports/<folder_id>/v{連番}.json`（append-only・不変）を1つ書く ＋ Supabase
 * `photo_reports`（現在版1件）を上書き。ロールバック = 旧版の内容で新版を書く（1版として記録）。
 * 書くのは report-app（RW トークン）。ワーカーは readonly 据置。
 * 仕様: docs/architecture/slack-photo-report-architecture.md §5
 */
import {
  createTextFile,
  listFolderFiles,
  readTextFileById,
  resolveReportVersionsDir,
  setFileDescription,
  trashFileById
} from "@/lib/drive-write";
import {
  buildVersionFile,
  formatVersionFileName,
  nextVersionNumber,
  parseVersionNumber,
  type ReportVersionSource
} from "@/lib/report-versions";
import { sbPatch, sbSelect, sbUpsert } from "@/lib/supabase-rest";
import { photoReportDraftSchema, type PhotoReportDraft } from "@/schemas/photo-report";

export type SavedVersion = { version: number; fileName: string; savedAt: string };

export type VersionListEntry = {
  version: number;
  fileId: string;
  modifiedTime?: string;
  label?: string; // 人が付けた版名（Drive description）
  createdBy?: string; // 作成者メール（Drive appProperties.createdBy）。削除可否の判定に使う
};

/** 現在版を Supabase `photo_reports` に上書き（folder_id キー）。 */
async function upsertCurrent(
  report: PhotoReportDraft,
  source: ReportVersionSource,
  generatedAt: string
): Promise<void> {
  await sbUpsert(
    "photo_reports",
    {
      folder_id: report.driveFolderId,
      case_id: report.caseId,
      report_json: report,
      source,
      generated_at: generatedAt
    },
    "folder_id"
  );
}

/**
 * 新版を1つ書き（append-only）、現在版（Supabase）を差し替える。
 * report は検証済み前提（routes 側で photoReportDraftSchema.parse する）。
 */
export async function saveReportVersion(args: {
  report: PhotoReportDraft;
  source: ReportVersionSource;
  createdBy?: string;
  note?: string;
  label?: string;
  folderName?: string;
}): Promise<SavedVersion> {
  const { report } = args;
  const dirId = await resolveReportVersionsDir(report.driveFolderId, true);
  if (!dirId) throw new Error("版ディレクトリを解決できませんでした。");

  const existing = await listFolderFiles(dirId);
  const version = nextVersionNumber(existing.map((f) => f.name));
  const fileName = formatVersionFileName(version);

  const payload = buildVersionFile({
    version,
    report,
    source: args.source,
    createdBy: args.createdBy,
    note: args.note,
    folderName: args.folderName
  });
  // 版名（label）は Drive description、作成者は appProperties＝いずれもメタデータ（本文は不変）。
  await createTextFile(dirId, fileName, JSON.stringify(payload, null, 2), {
    description: args.label?.trim() || undefined,
    appProperties: args.createdBy ? { createdBy: args.createdBy } : undefined
  });
  await upsertCurrent(report, args.source, payload.generatedAt);

  return { version, fileName, savedAt: payload.generatedAt };
}

/** 版一覧（新しい版＝大きい番号が先頭）。版ディレクトリが無ければ空配列。 */
export async function listReportVersions(folderId: string): Promise<VersionListEntry[]> {
  const dirId = await resolveReportVersionsDir(folderId, false);
  if (!dirId) return [];
  const files = await listFolderFiles(dirId);
  const out: VersionListEntry[] = [];
  for (const f of files) {
    const version = parseVersionNumber(f.name);
    if (version === null) continue;
    out.push({
      version,
      fileId: f.id,
      modifiedTime: f.modifiedTime,
      label: f.description,
      createdBy: f.appProperties?.createdBy
    });
  }
  out.sort((a, b) => b.version - a.version);
  return out;
}

/** 版にラベル（版名）を付ける/変更する＝Drive description のみ更新（本文は不変）。 */
export async function renameReportVersion(
  folderId: string,
  version: number,
  label: string
): Promise<void> {
  const dirId = await resolveReportVersionsDir(folderId, false);
  if (!dirId) throw new Error("版ディレクトリがありません。");
  const files = await listFolderFiles(dirId);
  const target = files.find((f) => parseVersionNumber(f.name) === version);
  if (!target) throw new Error(`版 v${version} が見つかりません。`);
  await setFileDescription(target.id, label.trim().slice(0, 200));
}

/**
 * 版を削除する＝Drive ゴミ箱へ（復元可・物理削除しない）。
 * - **最新版は削除不可**（現在版＝Slack/ページの表示元・版番号連番の起点。先に別版へ戻すこと）。
 * - **作成者本人のみ削除可**（`requesterEmail` と版の作成者を照合）。作成者未記録の旧版／
 *   識別できない場合（IAP なしのローカル）は制限しない。
 */
export async function deleteReportVersion(
  folderId: string,
  version: number,
  requesterEmail?: string | null
): Promise<void> {
  const dirId = await resolveReportVersionsDir(folderId, false);
  if (!dirId) throw new Error("版ディレクトリがありません。");
  const files = await listFolderFiles(dirId);
  const versions = files
    .map((f) => parseVersionNumber(f.name))
    .filter((n): n is number => n !== null);
  if (versions.length === 0) throw new Error("版がありません。");
  const latest = Math.max(...versions);
  if (version === latest) {
    throw new Error("最新版は削除できません（現在版のため）。先に別の版へ戻してから削除してください。");
  }
  const target = files.find((f) => parseVersionNumber(f.name) === version);
  if (!target) throw new Error(`版 v${version} が見つかりません。`);

  const owner = target.appProperties?.createdBy;
  if (owner && requesterEmail && owner !== requesterEmail) {
    throw new Error(`この版は ${owner} が作成したため削除できません（作成者本人のみ）。`);
  }
  await trashFileById(target.id);
}

/** 指定版の report（中身）を読む。版ファイルでなくても素の report として許容。 */
async function readVersionReport(
  folderId: string,
  version: number
): Promise<PhotoReportDraft> {
  const dirId = await resolveReportVersionsDir(folderId, false);
  if (!dirId) throw new Error("版ディレクトリがありません。");
  const files = await listFolderFiles(dirId);
  const target = files.find((f) => parseVersionNumber(f.name) === version);
  if (!target) throw new Error(`版 v${version} が見つかりません。`);
  const text = await readTextFileById(target.id);
  const parsed = JSON.parse(text) as unknown;
  // 自己記述ファイルなら .report、素の report ならそのまま。
  const raw =
    parsed && typeof parsed === "object" && "report" in parsed
      ? (parsed as { report: unknown }).report
      : parsed;
  return photoReportDraftSchema.parse(raw);
}

/**
 * WEB から AI 生成（再生成）を依頼する＝`photo_report_jobs` を投入/再投入。
 * folder_id で既存ジョブを探し、あれば queued に戻す（done/error/processing 問わず＝最新写真＋最新設定で作り直し）、
 * 無ければ新規 INSERT（dedupe_key=`web:<folder_id>`）。ワーカーが queued を拾って生成し、設定をプロンプトへ反映。
 * Slack 起点ジョブとは folder_id で収束する（同フォルダ＝同報告書）。
 */
export async function requestGeneration(
  folderId: string,
  caseId: string,
  mode: "full" | "summary" = "full"
): Promise<{ requeued: boolean }> {
  const existing = await sbSelect<{ id: number }>(
    `photo_report_jobs?folder_id=eq.${encodeURIComponent(folderId)}&select=id&limit=1`
  );
  if (existing[0]) {
    await sbPatch(`photo_report_jobs?id=eq.${existing[0].id}`, {
      status: "queued",
      mode, // 依頼のたびに上書き（full=全生成 / summary=まとめだけ）。生成は folder 単位で1件ずつ。
      error: null,
      notified_at: null,
      updated_at: new Date().toISOString()
    });
    return { requeued: true };
  }
  await sbUpsert("photo_report_jobs", {
    dedupe_key: `web:${folderId}`,
    folder_id: folderId,
    case_id: caseId || null,
    status: "queued",
    mode
  });
  return { requeued: false };
}

/** WEB「AIで再作成」の完了監視用：folder の最新ジョブ状態を返す（queued|processing|done|error|null）。 */
export async function getGenerationStatus(folderId: string): Promise<{ status: string | null }> {
  const rows = await sbSelect<{ status: string }>(
    `photo_report_jobs?folder_id=eq.${encodeURIComponent(folderId)}&select=status&order=id.desc&limit=1`
  );
  return { status: rows[0]?.status ?? null };
}

/** 現在版 report の「概要・内容」だけを返す（まとめだけAI生成の完了反映用＝ページ全体を再読込せずに済む）。 */
export async function getReportSummary(
  folderId: string
): Promise<{ headerSummary: string; workItems: string[] }> {
  const rows = await sbSelect<{ report_json: { headerSummary?: string; workItems?: string[] } }>(
    `photo_reports?folder_id=eq.${encodeURIComponent(folderId)}&select=report_json&limit=1`
  );
  const r = rows[0]?.report_json;
  return { headerSummary: r?.headerSummary ?? "", workItems: r?.workItems ?? [] };
}

/**
 * 旧版へロールバック ＝ 旧版の内容で **新版を書く**（過去版は書き換えない＝監査に強い）。
 * folder_id は呼び出し側の認可済み folderId で上書きする（版ファイルの値を信用しない）。
 */
export async function rollbackToVersion(args: {
  folderId: string;
  caseId: string;
  version: number;
  createdBy?: string;
}): Promise<SavedVersion> {
  const report = await readVersionReport(args.folderId, args.version);
  // 認可済みの folderId / caseId を権威とする。
  report.driveFolderId = args.folderId;
  report.caseId = args.caseId;
  return saveReportVersion({
    report,
    source: "human",
    createdBy: args.createdBy,
    note: `v${args.version} からロールバック`
  });
}
