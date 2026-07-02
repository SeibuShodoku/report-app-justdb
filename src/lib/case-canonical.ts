/**
 * 写真報告書の「正本」指定（案件単位・サーバー専用）。
 *
 * 案件には日付フォルダ（写真_YYYYMMDD）単位で複数の報告書がぶら下がるため、
 * 「AI が次の報告書を作る時にどの前回報告書を読むべきか」が一意でない。
 * 人がポータルで 1 つを **正本** に指定し、その指しどころをここで永続化する。
 *
 * 保存先＝**案件フォルダ/_ai/canonical-report.json**（Drive）。
 * - AI 生成の文脈（digest.md）と同じ `_ai/` に置く＝VM ワーカーは既存の
 *   「folder→親→_ai/」探索でそのまま読める（Supabase migration 不要）。
 * - 案件フォルダは日付フォルダの親として解決する（getParentId）。
 */
import {
  AI_FOLDER_NAME,
  driveWriteConfigured,
  ensureSubfolder,
  findSubfolder,
  getParentId,
  readTextFileByName,
  upsertTextFile
} from "@/lib/drive-write";

export type CanonicalReport = {
  caseId: string;
  /** 正本の日付フォルダ（写真_YYYYMMDD）の Drive フォルダID。 */
  folderId: string;
  setBy: string | null;
  setAt: string;
};

const CANONICAL_FILE = "canonical-report.json";

/** 案件フォルダの _ai/ から正本指定を読む。無い・壊れている時は null（未指定扱い）。 */
export async function readCanonicalReport(caseFolderId: string): Promise<CanonicalReport | null> {
  try {
    const ai = await findSubfolder(caseFolderId, AI_FOLDER_NAME);
    if (!ai) return null;
    const text = await readTextFileByName(ai, CANONICAL_FILE);
    if (!text) return null;
    const j = JSON.parse(text) as Partial<CanonicalReport>;
    if (typeof j.folderId !== "string" || !j.folderId) return null;
    return {
      caseId: String(j.caseId ?? ""),
      folderId: j.folderId,
      setBy: typeof j.setBy === "string" ? j.setBy : null,
      setAt: String(j.setAt ?? "")
    };
  } catch {
    return null;
  }
}

/** 正本を指定する（日付フォルダの親＝案件フォルダの _ai/ に upsert・冪等）。 */
export async function writeCanonicalReport(
  caseId: string,
  dayFolderId: string,
  setBy: string | null
): Promise<void> {
  if (!driveWriteConfigured()) {
    throw new Error("Drive 書込みが未設定のため正本を保存できません。");
  }
  const caseFolderId = await getParentId(dayFolderId);
  if (!caseFolderId) throw new Error("案件フォルダ（親フォルダ）を特定できませんでした。");
  const ai = await ensureSubfolder(caseFolderId, AI_FOLDER_NAME);
  const body: CanonicalReport = {
    caseId,
    folderId: dayFolderId,
    setBy,
    setAt: new Date().toISOString()
  };
  await upsertTextFile(ai, CANONICAL_FILE, JSON.stringify(body, null, 2), "application/json");
}
