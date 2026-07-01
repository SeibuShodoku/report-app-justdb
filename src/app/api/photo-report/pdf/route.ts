import { driveWriteConfigured, upsertBinaryFile } from "@/lib/drive-write";
import { authorizeFolderAccess } from "@/lib/security/proxy-auth";

export const runtime = "nodejs";
// PDF 生成は時間がかかる（Chromium 起動＋描画）。長めに許容。
export const maxDuration = 60;

/**
 * サーバー側 PDF 生成（決定的出力）。
 *
 * 方式 A（docs/architecture/justdb-supabase-integration の議論）：同一 Cloud Run コンテナ内の
 * ヘッドレス Chromium で、既存の印刷ビュー `/report/photo?folderId&token`（A4固定CSS）を localhost
 * から開いて `page.pdf()`。レイアウト資産を二重実装せず再利用し、IAP も跨がない（localhost）。
 *
 * 描画するのは **保存済み現在版**（ページがサーバーで現在版をロードするため）。ブラウザの未保存編集は
 * 反映されない（先に保存してから押す運用）。Chromium 未導入の環境では 503（既存の「未設定なら503」と同作法）。
 *
 * Chromium のクラッシュ要因（裏取り済）への手当て：
 * - `--disable-dev-shm-usage`（Docker の /dev/shm 既定 64MB 枯渇＝"Target closed" の主因）
 * - `--no-sandbox`（コンテナでユーザー名前空間が無く起動不可になるのを回避）
 * - Cloud Run は memory 2Gi 目安（Chromium はメモリ食い）／dumb-init で孤児プロセス回収（Dockerfile）
 *
 * 例: GET /api/photo-report/pdf?folderId=DIR&token=...
 */
export async function POST(request: Request) {
  return handle(request);
}
export async function GET(request: Request) {
  return handle(request);
}

async function handle(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const folderId = params.get("folderId")?.trim();
  const token = params.get("token")?.trim();
  if (!folderId) return Response.json({ error: "folderId が必要です。" }, { status: 400 });
  if (!token) return Response.json({ error: "token が必要です（起動トークン）。" }, { status: 400 });

  const auth = authorizeFolderAccess(request, folderId);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.mode !== "browser") {
    return Response.json({ error: "PDF 生成は人の操作に限ります（起動トークン）。" }, { status: 403 });
  }

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (!executablePath) {
    // ローカル等 Chromium 未導入。window.print() の固定A4を使ってもらう。
    return Response.json(
      { error: "サーバーPDFは未設定です（PUPPETEER_EXECUTABLE_PATH 未設定）。当面は『PDFで保存（印刷）』をご利用ください。" },
      { status: 503 }
    );
  }

  // 自分自身（localhost）の印刷ビューを開く＝IAP を跨がない。token はそのまま渡す。
  const port = process.env.PORT?.trim() || "8080";
  const printUrl =
    `http://127.0.0.1:${port}/report/photo` +
    `?folderId=${encodeURIComponent(folderId)}&token=${encodeURIComponent(token)}`;

  // 動的 import（puppeteer-core を未使用ルートで読み込まない＝起動軽量化）。
  const puppeteer = (await import("puppeteer-core")).default;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });
    const page = await browser.newPage();
    await page.goto(printUrl, { waitUntil: "networkidle0", timeout: 45_000 });
    // クライアント島（注記SVG）の描画と画像確定を待つ。
    await page.emulateMediaType("print");
    await page
      .evaluate(
        () =>
          Promise.all(
            Array.from(document.images)
              .filter((img) => !img.complete)
              .map(
                (img) =>
                  new Promise((resolve) => {
                    img.addEventListener("load", resolve, { once: true });
                    img.addEventListener("error", resolve, { once: true });
                  })
              )
          ).then(() => undefined)
      )
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 700)); // 注記レイヤーの ResizeObserver 描画ぶん

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true // globals.css の @page size:A4 / margin を尊重
    });
    await browser.close().catch(() => undefined);
    browser = null; // Drive アップロード前に Chromium を閉じてメモリを解放

    // save=1 ＝紐付く案件フォルダへ PDF を保存（同名 upsert＝毎回最新1つ）。それ以外は PDF を返す。
    if (params.get("save") === "1") {
      if (!driveWriteConfigured()) {
        return Response.json({ error: "Drive書込未設定のため保存できません。" }, { status: 503 });
      }
      const name = "写真報告書.pdf";
      await upsertBinaryFile(folderId, name, "application/pdf", Buffer.from(pdf));
      return Response.json({ ok: true, savedToDrive: true, name });
    }

    // inline=1 ＝ブラウザ内で表示（iPhone のプレビュー用。既定は attachment＝ダウンロード）。
    const disposition = params.get("inline") === "1" ? "inline" : "attachment";
    const filename = `写真報告書-${folderId}.pdf`;
    return new Response(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "PDF 生成に失敗しました。";
    // 実行ファイルが見つからない等の構成エラーは 503、それ以外は 500。
    const status = /ENOENT|executable|spawn|Failed to launch/i.test(msg) ? 503 : 500;
    return Response.json({ error: `PDF 生成に失敗：${msg}` }, { status });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
