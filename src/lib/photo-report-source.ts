/**
 * 写真報告書の「プリフィル元データ」を組み立てるサーバーヘルパー。
 *
 * 当面は Drive フォルダの画像一覧から素の下書き（見出し・注記なし）を合成する＝
 * 「フォルダの写真をそのまま並べた写真報告書」。
 * Phase 2 で VM 常駐 Claude が生成した report JSON（Supabase 保存）を載せ、
 * heading / annotationNote / 並び / headerSummary を上書きする予定（下記 TODO）。
 *
 * 仕様: docs/spec/slack-photo-report.md §6 / 実装計画 §1c・§2
 */
import { driveListImages, type DriveImage } from "@/lib/drive";
import { sbSelect, supabaseConfigured } from "@/lib/supabase-rest";

export type PhotoReportItemView = {
  fileId: string;
  name: string;
  mimeType: string;
  heading?: string;
  annotationNote?: string;
};

export type PhotoReportView = {
  caseId: string;
  driveFolderId: string;
  headerSummary?: string;
  photoItems: PhotoReportItemView[];
};

/**
 * Drive 画像一覧を写真報告ビューへ変換する（純粋関数・テスト対象）。
 */
export function imagesToView(
  caseId: string,
  folderId: string,
  images: DriveImage[]
): PhotoReportView {
  return {
    caseId,
    driveFolderId: folderId,
    photoItems: images.map((im) => ({
      fileId: im.fileId,
      name: im.name,
      mimeType: im.mimeType
    }))
  };
}

/** Supabase `photo_reports` に保存された AI 生成 report JSON の形（必要分のみ）。 */
export type StoredReportJson = {
  headerSummary?: string;
  photoItems: Array<{ fileId: string; heading?: string; annotationNote?: string }>;
};

/**
 * 保存済み report JSON をフォルダ画像ビューへ重ねる（純粋関数・テスト対象）。
 * - 並び・見出し・注記は保存JSONを優先。
 * - JSON にあるがフォルダに無い fileId はスキップ（実体が消えた等）。
 * - JSON に無いフォルダ写真は末尾に追加（取りこぼし防止）。
 */
export function overlayReport(
  view: PhotoReportView,
  stored: StoredReportJson | null
): PhotoReportView {
  if (!stored) return view;
  const byId = new Map(view.photoItems.map((p) => [p.fileId, p]));
  const used = new Set<string>();
  const ordered: PhotoReportItemView[] = [];

  for (const item of stored.photoItems) {
    const base = byId.get(item.fileId);
    if (!base) continue;
    ordered.push({
      ...base,
      heading: item.heading ?? base.heading,
      annotationNote: item.annotationNote ?? base.annotationNote
    });
    used.add(item.fileId);
  }
  for (const p of view.photoItems) {
    if (!used.has(p.fileId)) ordered.push(p);
  }
  return {
    ...view,
    headerSummary: stored.headerSummary ?? view.headerSummary,
    photoItems: ordered
  };
}

/**
 * 保存済み report JSON を Supabase から読む（無ければ null）。
 * テーブル未作成・未設定でも素のフォルダ合成へフォールバックできるよう、失敗は握りつぶす。
 */
async function loadStoredReport(folderId: string): Promise<StoredReportJson | null> {
  if (!supabaseConfigured()) return null;
  try {
    const rows = await sbSelect<{ report_json: StoredReportJson }>(
      `photo_reports?folder_id=eq.${encodeURIComponent(folderId)}&select=report_json&limit=1`
    );
    return rows[0]?.report_json ?? null;
  } catch {
    return null;
  }
}

/**
 * フォルダの写真からプリフィル用ビューを読み込む。
 * AI 生成 report JSON（Supabase）があれば、それで見出し・注記・並び・要約を上書きする。
 */
export async function loadPhotoReportView(
  caseId: string,
  folderId: string
): Promise<PhotoReportView> {
  const [images, stored] = await Promise.all([
    driveListImages(folderId),
    loadStoredReport(folderId)
  ]);
  return overlayReport(imagesToView(caseId, folderId, images), stored);
}

/**
 * ブラウザが画像プロキシ経由で写真を取得する URL を組み立てる。
 * token は起動トークン（フォルダ一致を検証される）。
 */
export function photoProxyUrl(
  fileId: string,
  folderId: string,
  token: string
): string {
  const params = new URLSearchParams({ fileId, folderId, token });
  return `/api/photo?${params.toString()}`;
}
