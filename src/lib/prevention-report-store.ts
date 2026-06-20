/**
 * 防除作業報告書（紺谷V）の保存・版管理オーケストレーション（サーバー専用）。
 *
 * 写真報告書（`photo-report-store.ts`）と**同じ版管理基盤**を流用する：
 *   保存 = Drive `_ai/reports/<folder_id>/prevention/v{連番}.json`（append-only・不変）＋ Supabase
 *   `prevention_reports`（現在版1件・folder_id キー）。ロールバック = 旧版の内容で新版を書く。
 * 写真と folder_id を共有しても衝突しないよう **`prevention/` サブフォルダに名前空間分離**する
 * （写真は `_ai/reports/<folder_id>/` 直下のまま不変）。AI 生成（再生成）は持たない＝人入力のみ。
 *
 * 仕様: docs/spec/ring1a-prevention-report.md / docs/vision/case-portal.md §4.5
 */
import {
  createTextFile,
  ensureSubfolder,
  findSubfolder,
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
import { sbUpsert } from "@/lib/supabase-rest";
import { preventionReportDraftSchema, type PreventionReportDraft } from "@/schemas/prevention-report";

export type SavedVersion = { version: number; fileName: string; savedAt: string };

export type VersionListEntry = {
  version: number;
  fileId: string;
  modifiedTime?: string;
  label?: string; // 人が付けた版名（Drive description）
  createdBy?: string; // 作成者メール（Drive appProperties.createdBy）。削除可否の判定に使う
};

/**
 * 防除の版ディレクトリ＝写真と同じ `_ai/reports/<folderId>/` 配下に `prevention/` を名前空間分離。
 * 写真側 `resolveReportVersionsDir` をそのまま再利用し、その下に prevention サブフォルダを足すだけ。
 */
async function resolvePreventionVersionsDir(
  folderId: string,
  create: boolean
): Promise<string | null> {
  const base = await resolveReportVersionsDir(folderId, create); // _ai/reports/<folderId>/
  if (!base) return null;
  return create ? ensureSubfolder(base, "prevention") : findSubfolder(base, "prevention");
}

/** 現在版を Supabase `prevention_reports` に上書き（folder_id キー）。 */
async function upsertCurrent(
  report: PreventionReportDraft,
  source: ReportVersionSource,
  generatedAt: string
): Promise<void> {
  await sbUpsert(
    "prevention_reports",
    {
      folder_id: report.driveFolderId,
      case_id: report.caseId,
      construction_id: report.constructionId ?? null,
      report_json: report,
      source,
      generated_at: generatedAt
    },
    "folder_id"
  );
}

/**
 * 新版を1つ書き（append-only）、現在版（Supabase）を差し替える。
 * report は検証済み前提（routes 側で preventionReportDraftSchema.parse する）。
 */
export async function saveReportVersion(args: {
  report: PreventionReportDraft;
  source: ReportVersionSource;
  createdBy?: string;
  note?: string;
  label?: string;
  folderName?: string;
}): Promise<SavedVersion> {
  const { report } = args;
  const dirId = await resolvePreventionVersionsDir(report.driveFolderId, true);
  if (!dirId) throw new Error("版ディレクトリを解決できませんでした。");

  const existing = await listFolderFiles(dirId);
  const version = nextVersionNumber(existing.map((f) => f.name));
  const fileName = formatVersionFileName(version);

  const payload = buildVersionFile({
    version,
    report,
    source: args.source,
    reportType: "prevention",
    createdBy: args.createdBy,
    note: args.note,
    folderName: args.folderName
  });
  await createTextFile(dirId, fileName, JSON.stringify(payload, null, 2), {
    description: args.label?.trim() || undefined,
    appProperties: args.createdBy ? { createdBy: args.createdBy } : undefined
  });
  await upsertCurrent(report, args.source, payload.generatedAt);

  return { version, fileName, savedAt: payload.generatedAt };
}

/** 版一覧（新しい版＝大きい番号が先頭）。版ディレクトリが無ければ空配列。 */
export async function listReportVersions(folderId: string): Promise<VersionListEntry[]> {
  const dirId = await resolvePreventionVersionsDir(folderId, false);
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
  const dirId = await resolvePreventionVersionsDir(folderId, false);
  if (!dirId) throw new Error("版ディレクトリがありません。");
  const files = await listFolderFiles(dirId);
  const target = files.find((f) => parseVersionNumber(f.name) === version);
  if (!target) throw new Error(`版 v${version} が見つかりません。`);
  await setFileDescription(target.id, label.trim().slice(0, 200));
}

/**
 * 版を削除する＝Drive ゴミ箱へ（復元可・物理削除しない）。
 * - **最新版は削除不可**（現在版＝表示元・連番の起点）。
 * - **作成者本人のみ削除可**（`requesterEmail` と版の作成者を照合）。作成者未記録は制限しない。
 */
export async function deleteReportVersion(
  folderId: string,
  version: number,
  requesterEmail?: string | null
): Promise<void> {
  const dirId = await resolvePreventionVersionsDir(folderId, false);
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

/** 指定版の report（中身）を読む。自己記述ファイルなら .report、素の report ならそのまま。 */
async function readVersionReport(
  folderId: string,
  version: number
): Promise<PreventionReportDraft> {
  const dirId = await resolvePreventionVersionsDir(folderId, false);
  if (!dirId) throw new Error("版ディレクトリがありません。");
  const files = await listFolderFiles(dirId);
  const target = files.find((f) => parseVersionNumber(f.name) === version);
  if (!target) throw new Error(`版 v${version} が見つかりません。`);
  const text = await readTextFileById(target.id);
  const parsed = JSON.parse(text) as unknown;
  const raw =
    parsed && typeof parsed === "object" && "report" in parsed
      ? (parsed as { report: unknown }).report
      : parsed;
  return preventionReportDraftSchema.parse(raw);
}

/**
 * 旧版へロールバック ＝ 旧版の内容で **新版を書く**（過去版は書き換えない＝監査に強い）。
 * folder_id / caseId は呼び出し側の認可済み値で上書きする（版ファイルの値を信用しない）。
 */
export async function rollbackToVersion(args: {
  folderId: string;
  caseId: string;
  version: number;
  createdBy?: string;
}): Promise<SavedVersion> {
  const report = await readVersionReport(args.folderId, args.version);
  report.driveFolderId = args.folderId;
  report.caseId = args.caseId;
  return saveReportVersion({
    report,
    source: "human",
    createdBy: args.createdBy,
    note: `v${args.version} からロールバック`
  });
}
