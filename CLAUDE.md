@AGENTS.md

# 矢書（やぶみ）

個人開発者向けの SNS 運用ツール。要求は docs/requirements.md、構成は docs/architecture.md、段取りと進捗は docs/roadmap.md。

## 約束事

- 利用者はマーケティングの完全な素人だと思って設計する。空欄に自分で書かせるのではなく、AI が質問しながら一緒に整理し、案と理由を出して利用者が選べるようにする。用語は使う前にかみ砕き、決めにくいことは選択肢と長所・短所で示す
- UI の文言とドキュメントは日本語。マーケティング用語には `<Term k="..." />` で解説を添え、用語は src/lib/glossary/terms.ts に足す
- テーブルを追加したら必ず RLS を有効にし、tests/ に他人から読めないことを確かめる結合テストを足す
- マイグレーションの適用は `supabase migration up`（データを残す）。`supabase db reset` はローカルの全データを消す（利用者が登録したアカウントも消える）ので、オーナーの了承なしに使わない。消えても supabase/seed.sql のテスト用アカウントとサンプルは戻る
- マイグレーション後は `pnpm db:types` で src/lib/supabase/database.types.ts を再生成する
- Next.js 16 なので middleware ではなく src/proxy.ts。cookies() や params は await する
- ローカルのポートは Next.js が 3100、Supabase が 553xx（同じマシンで別プロジェクトが 3000 と 543xx を使っているため）
- 月額 3,000 円の予算内に収める。有料の API を足すときは docs/architecture.md に費用を書く

## デザイン

- 正は docs/design/design_handoff_yabumi_1b/（README.md と参照用 HTML）。トークンは src/app/globals.css に貼り付けてあり、値を変えるときは handoff の README と揃える
- 色は必ずトークンのクラス（bg-surface、text-muted、border-line、bg-primary text-on-primary など）で指定し、色コードを直接書かない
- 藍（primary）が押すもの。朱（signal）は「● 予約」「要確認」などの印だけに使い、ボタンには使わない
- カードに影は付けない（枠線 1px のみ）。影はポップアップだけ（shadow-pop）
- 部品は src/components/ui/ にある。新しい画面はまずここの部品で組む
- まだ作っていない機能へのボタンやメニューは、押せない状態で「準備中」と出す
