# 利用規約とプライバシーポリシー

- **作成日**: 2026-10-11
- **状態**: 下書き（オーナーの確認前）。画面は /terms と /privacy。先頭に「確認中の下書き」と出し、決まっていないところは「（確認中）」と出す
- **正とするもの**: データの扱いは [architecture.md の 4.14](architecture.md)。Anthropic・SNS 各社の扱いは、下の「調べたこと」（2026-10-11 に各社の公式の資料で確認）
- **法的な最終確認はオーナーが行う**。必要なら専門家（弁護士）に見てもらう

## 置き場所

| もの | 場所 |
|---|---|
| 利用規約 | src/app/terms/page.tsx |
| プライバシーポリシー | src/app/privacy/page.tsx |
| 運営者・問い合わせ先・施行日・管轄・年齢・下書きの印 | src/lib/legal/info.ts（`LEGAL`。決まったら値を入れ、`draft: false` にする） |
| 共通の枠と表 | src/components/legal/legal-page.tsx |
| リンク | トップのフッター、登録・ログインの画面の下、登録の画面の同意の一文、両ページのフッター |
| ログインなしで開ける | src/lib/supabase/proxy.ts の PUBLIC_PATHS |

## オーナーに確かめてほしい点

| # | 点 | いまの下書き | 選択肢と考え方 |
|---|---|---|---|
| L1 | **運営者の表示** | 屋号 **YuXport Labs**（2026-10-11 オーナーが決定。表記はこのとおり）。代表者の氏名も出す。氏名の表記は確認中 | 「YuXport Labs（代表 （確認中））」と出している（src/lib/legal/info.ts の operator と representative）。Meta のビジネス認証の名義（docs/review/README.md の R2）と同じ。無料のうちは特定商取引法の表示は要らないが、有料にするなら氏名（または名称）・住所・電話番号の表示が要る（L5） |
| L2 | **問い合わせ先** | 「（確認中）」 | `support@yabumi.app`（Cloudflare Email Routing で運営者のメールに転送。deploy.md の 11 の G）。G-4 で届くのを確かめてから src/lib/legal/info.ts の contact に入れる。個人のメールは公開ページに載せない。個人情報保護法で、開示などの求めを受ける窓口が要る |
| L3 | **準拠法と裁判所** | 日本の法律、管轄は「（確認中）」 | オーナーの住所に近い地方裁判所が一般的（例: 東京地方裁判所）。利用者が消費者のとき、遠くの裁判所に決めても無効とされることがある |
| L4 | **登録できる年齢** | 18 歳以上（確認中） | 18 歳以上: いちばん簡単。SNS 各社も 13 歳以上などの制限があり、規約で合わせやすい / 13 歳以上（18 歳未満は保護者の同意）: 対象は広がるが、同意を確かめる仕組みが要る。矢書は個人開発者向けなので 18 歳以上をおすすめ |
| L5 | **有料にしたときの扱い** | 「いまは無料。有料にするときは前もって知らせ、申し込んだ人だけ払う」 | 有料プランを始めるときに、料金・支払い方法・解約・返金を規約に足し、特定商取引法の表示のページ（/tokushoho など）を作る。支払いの仕組み（Stripe など）も決める |
| L6 | **Vercel のプラン** | 書いていない | Vercel Hobby は「個人・非商用」だけ。無料で他の人に使ってもらうのが非商用に当たるかははっきりしない。有料にするなら Pro（$20/月）が要る。予算（月 3,000 円）とあわせて決める |
| L7 | **保存期間** | 会話は最後のやり取りから 1 年、利用量は 13 か月（**確定**、2026-10-11 オーナーの決定） | architecture.md の 4.14 |
| L8 | **施行日** | 「（確認中）」 | 登録の受付を開く日。それまでに L1〜L4 と L7 を埋める |
| L9 | **規約を変えるときの知らせ方** | 「施行日より前に画面やメールで知らせる」 | 民法の定型約款の変更（548 条の 4）に合わせ、変える内容と施行日を前もって出す。大きく変えるときは、メールでも知らせる |
| L10 | **責任の範囲** | 故意・重過失を除き、直接かつ通常の損害に限る。消費者契約法で無効になる部分は適用しない | 無料のサービスとしては一般的な書き方。有料にしたら、上限額（払った額まで、など）を足すか考える |
| L11 | **政府などからの開示の求めへの方針**（Meta の審査の質問） | docs/review/meta.md の下書き | 方針として掲げてよいか確かめる |

## 調べたこと（2026-10-11）

### Anthropic（Claude API）

| 点 | 内容 | 出典 |
|---|---|---|
| 学習に使うか | API で送った内容は、既定では学習に使わない（商用規約「Anthropic may not train models on Customer Content from Services」）。例外は、明示的にフィードバックを送ったときと、利用を許したとき。矢書はどちらもしていない | [商用規約](https://www.anthropic.com/legal/commercial-terms)、[学習に使うか](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)（2026-08-18 更新） |
| 保存期間 | 受け取ってから 30 日以内に消す。利用規定に反する疑いがあると判定されたら、入出力は最長 2 年、判定の点数は最長 7 年 | [保存期間](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)（2026-07-01 更新）、[API とデータの保存](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention) |
| 立場 | API では Anthropic はデータの処理者（processor）。データ処理の補足契約（DPA）が商用規約に組み込まれている | [DPA](https://www.anthropic.com/legal/data-processing-addendum) |
| 場所 | 処理は米国・欧州・アジア・オーストラリアの一部の国、保存は米国。日本だけで処理させる方法はない | [サーバーの場所](https://privacy.claude.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers)、[データの所在](https://platform.claude.com/docs/en/manage-claude/data-residency) |
| ZDR（保存しない契約） | 営業との契約で、Anthropic の承認が要る。個人開発で使える形ではない | 同上 |

- API の資料には「既定では保存しない（Fable と Mythos のモデルは 30 日必須）」とも書かれ、ヘルプの「30 日以内に消す」と書き方が違う。ポリシーには長いほうの「30 日以内」を書いた
- 矢書のモデル（Claude Opus 5.5）を変えるときは、この節を確かめ直す

### 外国にある第三者への提供（個人情報保護法 28 条）

- 送り先の多く（Anthropic、Meta、X、GitHub、Supabase、Vercel、Resend、Cloudflare（Turnstile・Email Routing））は米国の会社。ポリシーの第 4 条に、米国の制度の概要（連邦の包括的な法律がない）と、個人情報保護委員会の調査へのリンクを書いた
- SNS への投稿は、利用者の指示による送信。委託先（Supabase など）とは扱いが違うので、ポリシーでは「利用者がつないだときに、利用者の指示を受けて送る」と分けて書いた

### SNS 各社がポリシーに求めること

- Meta: プライバシーポリシーの URL（認可画面に出る）、データの削除の方法（矢書はコールバック /sns/threads/delete）
- X: 登録の前に見せる。集めるもの・使い道・X を含む渡す先・連絡先（docs/review/x.md）
- YouTube（つなぐときに追記）: YouTube API サービスを使うこと、Google のプライバシーポリシー、取り消しの方法など（docs/review/youtube.md）
- TikTok（つなぐときに追記）: 規約とポリシーをサイトの見える場所にリンク（済み）

### 画像（2026-10-11、architecture.md の 4.18）

- 投稿に添えた画像を「預かる情報」と「保存する期間」（送り終えて 30 日など）に足した。撮影の場所・日時・機種などの情報（Exif）は、受け取ったときに消して保存しないことを書いた
- SNS に送るものに画像と代わりの文を足した（Threads は 1 時間で切れる URL を渡し、Threads が取りに来る）

## 中身を変えるとき

- 新しい外部サービスや SNS を使い始める前に、/privacy の第 3 条（送り先）と第 5 条（保存期間）を書き足す
- architecture.md の 4.14 を変えたら、/privacy の第 1・5・6 条も揃える
- 公開した後に変えるときは、施行日を決めて前もって知らせる（L9）
