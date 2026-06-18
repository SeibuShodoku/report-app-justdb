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

/**
 * フォルダの写真からプリフィル用ビューを読み込む。
 */
export async function loadPhotoReportView(
  caseId: string,
  folderId: string
): Promise<PhotoReportView> {
  const images = await driveListImages(folderId);
  const view = imagesToView(caseId, folderId, images);
  // TODO(Phase2): Supabase に保存された AI 生成 report JSON があれば、
  //   fileId をキーに heading / annotationNote / 並び / headerSummary を上書きする。
  return view;
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
