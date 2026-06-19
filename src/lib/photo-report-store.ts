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
  resolveReportVersionsDir
} from "@/lib/drive-write";
import {
  buildVersionFile,
  formatVersionFileName,
  nextVersionNumber,
  parseVersionNumber,
  type ReportVersionSource
} from "@/lib/report-versions";
import { sbUpsert } from "@/lib/supabase-rest";
import { photoReportDraftSchema, type PhotoReportDraft } from "@/schemas/photo-report";

export type SavedVersion = { version: number; fileName: string; savedAt: string };

export type VersionListEntry = {
  version: number;
  fileId: string;
  modifiedTime?: string;
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
  note?: string;
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
    note: args.note,
    folderName: args.folderName
  });
  await createTextFile(dirId, fileName, JSON.stringify(payload, null, 2));
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
    out.push({ version, fileId: f.id, modifiedTime: f.modifiedTime });
  }
  out.sort((a, b) => b.version - a.version);
  return out;
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
 * 旧版へロールバック ＝ 旧版の内容で **新版を書く**（過去版は書き換えない＝監査に強い）。
 * folder_id は呼び出し側の認可済み folderId で上書きする（版ファイルの値を信用しない）。
 */
export async function rollbackToVersion(args: {
  folderId: string;
  caseId: string;
  version: number;
}): Promise<SavedVersion> {
  const report = await readVersionReport(args.folderId, args.version);
  // 認可済みの folderId / caseId を権威とする。
  report.driveFolderId = args.folderId;
  report.caseId = args.caseId;
  return saveReportVersion({
    report,
    source: "human",
    note: `v${args.version} からロールバック`
  });
}
