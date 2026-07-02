/**
 * 案件の写真報告書インデックス（正本フラグ＋手動並び順・サーバー専用）。
 *
 * 案件は時系列で進む：調査 → 調査報告書/見積 → 施工（複数回）→ 施工報告書。
 * 1回の調査・施工に対して報告書を**複数**作ることがあり、そのうち「顧客に届ける正」を
 * **正本**として指定する＝正本は案件に1つではなく**複数あり得る**（件ごと・解除も可能）。
 * 並びは日付（作成順）が最優先キーだが、人がポータルで手動調整できる。
 *
 * 保存先＝**案件フォルダ/_ai/report-index.json**（Drive・migration 不要）。
 * - `canonicalFolderIds` … 正本に指定した日付フォルダIDの配列（複数可）。
 *   VM ワーカーが次の報告書生成時に「前回の正本報告書（複数）」として読む。
 * - `order` … ポータルの表示順（folderId の配列・全件を明示）。空なら日付昇順。
 * - 報告書と調査予定ID/施工予定IDの紐付けは将来の整理事項（この形はその受け皿）。
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

export type CaseReportIndex = {
  caseId: string;
  /** ポータルの表示順（日付フォルダIDの配列）。空＝既定（日付昇順）。 */
  order: string[];
  /** 正本の日付フォルダID（複数可）。 */
  canonicalFolderIds: string[];
  updatedBy: string | null;
  updatedAt: string;
};

const INDEX_FILE = "report-index.json";

function emptyIndex(caseId: string): CaseReportIndex {
  return { caseId, order: [], canonicalFolderIds: [], updatedBy: null, updatedAt: "" };
}

/** 案件フォルダの _ai/ からインデックスを読む。無い・壊れている時は空（未指定扱い）。 */
export async function readReportIndex(caseFolderId: string): Promise<CaseReportIndex | null> {
  try {
    const ai = await findSubfolder(caseFolderId, AI_FOLDER_NAME);
    if (!ai) return null;
    const text = await readTextFileByName(ai, INDEX_FILE);
    if (!text) return null;
    const j = JSON.parse(text) as Partial<CaseReportIndex>;
    return {
      caseId: String(j.caseId ?? ""),
      order: Array.isArray(j.order) ? j.order.filter((s) => typeof s === "string") : [],
      canonicalFolderIds: Array.isArray(j.canonicalFolderIds)
        ? j.canonicalFolderIds.filter((s) => typeof s === "string")
        : [],
      updatedBy: typeof j.updatedBy === "string" ? j.updatedBy : null,
      updatedAt: String(j.updatedAt ?? "")
    };
  } catch {
    return null;
  }
}

/** 既存を読み→変更→upsert（日付フォルダの親＝案件フォルダに保存・冪等）。 */
async function updateReportIndex(
  caseId: string,
  referenceDayFolderId: string,
  updatedBy: string | null,
  mutate: (idx: CaseReportIndex) => void
): Promise<void> {
  if (!driveWriteConfigured()) {
    throw new Error("Drive 書込みが未設定のため保存できません。");
  }
  const caseFolderId = await getParentId(referenceDayFolderId);
  if (!caseFolderId) throw new Error("案件フォルダ（親フォルダ）を特定できませんでした。");
  const idx = (await readReportIndex(caseFolderId)) ?? emptyIndex(caseId);
  mutate(idx);
  idx.caseId = caseId || idx.caseId;
  idx.updatedBy = updatedBy;
  idx.updatedAt = new Date().toISOString();
  const ai = await ensureSubfolder(caseFolderId, AI_FOLDER_NAME);
  await upsertTextFile(ai, INDEX_FILE, JSON.stringify(idx, null, 2), "application/json");
}

/** 正本化／非正本化（複数可・トグル）。 */
export async function setReportCanonical(
  caseId: string,
  dayFolderId: string,
  canonical: boolean,
  updatedBy: string | null
): Promise<void> {
  await updateReportIndex(caseId, dayFolderId, updatedBy, (idx) => {
    const set = new Set(idx.canonicalFolderIds);
    if (canonical) set.add(dayFolderId);
    else set.delete(dayFolderId);
    idx.canonicalFolderIds = [...set];
  });
}

/** 表示順の保存（ポータルの現在表示の全件を明示的に受け取る）。 */
export async function saveReportOrder(
  caseId: string,
  referenceDayFolderId: string,
  order: string[],
  updatedBy: string | null
): Promise<void> {
  await updateReportIndex(caseId, referenceDayFolderId, updatedBy, (idx) => {
    idx.order = order.filter(Boolean);
  });
}
