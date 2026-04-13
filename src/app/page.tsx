import Link from "next/link";

/**
 * トップページ。
 * 本番運用ではJUST.DBのアプリリンク経由で `/report/new` を利用する。
 */
export default function HomePage() {
  return (
    <main>
      <section className="panel">
        <h1>報告書作成アプリ</h1>
        <p>JUST.DBのアプリリンクからアクセスしてください。</p>
        <p className="notice">
          開発時は
          <Link href="/report/new?caseId=DEMO001&token=replace-token">こちら</Link>
          から確認できます。
        </p>
      </section>
    </main>
  );
}
