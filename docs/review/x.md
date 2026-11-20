# X の審査と規約上の準備

- **作成日**: 2026-10-11
- **前提**: 従量課金（pay-per-use）、OAuth 2.0 + PKCE、スコープは tweet.read・tweet.write・users.read・offline.access・media.write（画像。architecture.md の 4.13・4.18）
- **使う API**: 投稿・削除・画像のアップロードと代わりの文、つないだ人のプロフィール（つなぐとき）、yabumi から送った投稿がまだあるかの確かめ（4.19）、投稿の数字とフォロワー数の読み取り（SNS_INSIGHTS に x を入れたとき。4.22 の段取り ⑥）
- **ポリシーとの一致**: 下の表の中身は /privacy の第 1〜6 条と揃えてある（2026-10-11 に突き合わせ）

## 審査は要るか

- **要らない**（と読める）。従量課金でアプリを作れば、他の人もそのアプリを認可できる。他の人のアカウントをつなぐための審査や、つなげる人数の上限は、公式の資料に書かれていない【未確認: 書かれていないことの確認】
- 守ること（[Developer Policy](https://docs.x.com/developer-terms/policy)）: 使い道を大きく変えたら X に知らせる / 同じ使い道でアプリを複数登録しない / 開発用のアプリを本番に使わない（いまは 1 つのアプリにローカルと本番のコールバックを並べている。これは「開発用を本番に使う」には当たらないが、アプリの名前に「Dev」などを付けない）

## 規約上、yabumi に要るもの（他の人のアカウントに投稿するアプリとして）

出典: [Developer Policy](https://docs.x.com/developer-terms/policy)、[Developer Agreement](https://docs.x.com/developer-terms/agreement)（2026-04-27 改定）、[Developer Guidelines](https://docs.x.com/developer-guidelines)

| 決まり | yabumi の対応 | 状態 |
|---|---|---|
| 投稿の前に、本人のはっきりした同意を得る（ログインしただけでは同意にならない） | 投稿は、利用者が「今すぐ送る」「予約」を押したときだけ | 済み |
| 投稿する前に、送る中身をそのまま見せる | 作成画面の SNS ごとのプレビュー（文字数と本文） | 済み |
| プライバシーポリシーを、登録・利用を始める前に見せる。集めるもの・使い道・X を含む渡す先・連絡先を書く | /privacy（登録の画面からリンク、同意の一文）。X への送信を書いた | 済み（連絡先は contact@yuxport.com） |
| X のパスワードを聞かない・持たない | OAuth だけ | 済み |
| yabumi の名前をはっきり出し、X と提携しているように見せない | 画面の名前は yabumi。X の名前は送り先の表示にだけ使う | 済み |
| 同じ・ほとんど同じ内容を、複数の X アカウントに投稿しない | 1 つの投稿の X の送り先は 1 つ（プロジェクトにつないだアカウント）。別のプロジェクトに同じ文を手で送ることは止めていないので、利用規約で禁じた | 済み（規約） |
| 求められていない @メンションを自動でしない | yabumi は文面を勝手に足さない。AI のネタ出しにも @ を入れさせない | 済み |
| AI が作った**返信**を送るには X の事前の承認が要る | yabumi は返信を作らない（投稿だけ。AI の下書きは利用者が直してから送る） | 対象外。返信の機能を作るなら先に申請する |
| 利用者や X から求められたら、保存した X のデータを 24 時間以内に消す | 「外す」と退会で、すぐに消す: アカウントの情報・トークン（X 側でも取り消す）・フォロワー数・ yabumi から送った投稿の数字・X 上の投稿の ID と URL（/privacy の第 5・6 条、architecture.md の 4.14。2026-10-11 に決めた）。yabumi で書いた本文と送った記録は利用者のものなので残す | 済み |
| 元の投稿が消えたら、保存した X の投稿も消すか直す | yabumi が持つのは、yabumi から送った投稿の ID と URL と、その投稿の数字だけ。X で消されたとわかったら（architecture.md の 4.19 の 3 つの経路）、取り消し済みにして、ID・URL と投稿の数字を DB のトリガーで消す | 済み |
| X のデータでモデルを学習しない | 学習しない。Anthropic は API の内容を学習に使わない（商用規約）。ただし、利用者が「AI と相談」「AI と振り返る」を使うときは、その利用者自身の X の投稿の数字（閲覧数・いいねなど）とフォロワー数を、助言のために Anthropic に送る（/privacy の第 3 条）。Developer Agreement が禁じているのはモデルの学習・微調整で、利用者本人への助言のための送信は当たらないと読める【未確認: オーナーが規約の該当の条を確かめる】。第三者への提供（再配布）と分析の条から見た検討は、下の「X の API で取ったデータを AI に送っている所」（2026-11-20 オーナーの判断で、今は直さない） | 済み（読み方は未確認） |
| 自動化アカウントのラベル（Automated） | 利用者が自分のアカウントに予約して送る使い方は bot に当たらないと読める【未確認】 | 様子を見る |

## X の API で取ったデータを AI に送っている所（2026-11-19 に調べた。2026-11-20 オーナーの判断で、今は直さない）

実装担当3 が X の開発者規約を読み、「X Content を明示の許可なく第三者に渡すことの禁止」と「分析は X が承認したものに限る」に当たりうると指摘した。これを受けて、X の API で取ったデータを AI（Anthropic・Google）に送っている所を洗い出した（実装担当2、main 4ebf38e）。

### 読んだ条（docs.x.com の公式の文書だけ。2026-11-19 に読んだ）

- [Developer Agreement](https://docs.x.com/developer-terms/agreement)（Last Updated: April 27, 2026。XIII 条までを読んだ。XIV 条から後は読めていない）
  - I.12: X Content に「X end user profile information」と派生物（derivative works）を含む。投稿の数字・フォロワー数・ユーザー名は名指しされていないが、「API で得たその他のデータ」に入ると読める
  - II.A.1: X Content の分析は「X が明示的に承認したもの」に限る。利用者本人の数字を本人のために分析することの例外は書かれていない
  - III.A(d): この合意で明示的に許したときを除き、Licensed Material（X の API と X Content）を第三者に渡さない
  - III.A(k): 基盤モデルの学習・微調整に使わない。推論のために AI の会社へ送ることについては、書かれていない
- [Developer Policy](https://docs.x.com/developer-terms/policy)（日付の表示なし）の Content redistribution
  - 第三者に渡せるのは、Post ID・User ID などに限る
  - 例外として、人の操作で、利用者 1 人に 1 日 500 件までの Post・User のオブジェクトを渡せる
  - 委託先（サービス提供者）に渡してよいという例外は、見つからなかった
- [Restricted use cases](https://docs.x.com/developer-terms/restricted-use-cases)（日付の表示なし）
  - 渡せる件数を「1 人に 1 日 50,000 件」としていて、Policy の 500 件と食い違う

### 送っている所（3 つ。どれも利用者が押したときだけ。ジョブが自動で送ることはない）

| # | 機能 | 送る中身（X の分） | 場所 | いつ |
|---|---|---|---|---|
| 1 | AI と相談・AI と振り返る（Anthropic） | 「投稿の閲覧数」と「フォロワー」の今週・先週、振り返りの「よく見られた投稿」（題と閲覧数）。SNS をまたいだ合計なので、X の post_metrics・account_metrics が混ざる | src/lib/ai/consult.ts の gatherConsultContext（KPI は毎回、振り返りの材料は振り返りのとき）、src/lib/ai/consult-actions.ts、src/lib/metrics/queries.ts（top_posts_by_views など） | 相談で送るたび（その KPI を選んでいて数字があるとき）。SNS_INSIGHTS に x を入れていなければ X の数字はない |
| 2 | アカウント設計の相談（Anthropic） | つないだ X のユーザー名（users/me で取ったもの。profile information に当たりうる） | src/lib/ai/plan-coach.ts の connectedAccounts、plan-coach-prompt.ts の「つないだアカウント」 | 設計の相談で送るたび |
| 3 | ネタ出しの「X で人気の投稿から」の A 案（yabumi の中で探す。Anthropic） | search/recent で取った他人の投稿の本文。「この投稿を元にする」で欄に入り、ネタを出すと送る | src/components/ideas/x-buzz-search.tsx → src/lib/ai/post-ideas.ts の buildXPostIdeasRequest・buildRefineIdeasRequest | 「探す」「この投稿を元にする」「ネタを出す」を押したとき。会話の控えは 1 日ほどで消す（docs/legal.md の 2026-11-06 の L3） |

送っていないもの:

- 自動の投稿の材料と、送る前のチェック: X のデータは入らない。時間帯の傾向は決まりで作り、AI に送らない
- 書き方の読み取り: yabumi の DB の投稿（利用者が書いた本文）から読む。X からは読まない
- コメント: X のコメントは取り込まない（中身を読まない）。sns_comments を AI に送る処理はない
- Gemini: 画像を作るだけで、X のデータは入らない
- B 案（利用者が X の画面で写して貼った文）: API で取っていないので、Agreement の Licensed Material には当たらないと読める【推測】

これまでの記録: 1 は上の表の「X のデータでモデルを学習しない」の行で、学習の条だけを見ていた。3 は docs/legal.md の「案: X の人気の投稿をネタの元にする」（2026-11-06）で、プライバシーポリシーの面だけを見ていた。2 は記録がなかった。どれも、再配布と分析の条からは検討していなかった。

### 直し方の案（今は採らない）

| # | 案 | 影響 |
|---|---|---|
| 1 | 相談・振り返りで AI に渡す閲覧数・フォロワー・よく見られた投稿から、X の分を外す（sns が x でないものだけで集める）。または、X の分は利用者が手で記録した数字だけを渡す | 分析の画面の数字は変わらない。AI の助言が X の数字なしになる（X が中心の人には粗くなる） |
| 2 | AI に渡すユーザー名を、アカウント設計で利用者が書いたものに替える。または「X をつないでいる」とだけ伝える | ほとんどない |
| 3 | 「この投稿を元にする」で入れるのを URL だけにし、本文は利用者が写して貼る（B と同じ）。または A 案をやめる | 利用者の手間が 1 つ増える（やめるなら X_BEARER_TOKEN の検索の費用もなくなる）。/privacy の Anthropic の行の「本サービスの中で探した結果から選んだもの」を直す |
| 共通 | X に書面の許可を取る | 申請の手間。通るかはわからない |

### 決めたこと・決めていないこと

- **2026-11-20 オーナーの判断で、今は直さない**（PM 経由）。他の人に提供する前（公開の段階 ② の前）に見直す（docs/launch-checklist.md の 1.3）
- **判断していないこと**: 分析の条（II.A.1）を広く読むと、AI に送らなくても、yabumi が X の数字を集計して見せること（分析の画面・時間帯の傾向・自動の投稿の時刻の案）自体が「X の承認が要る分析」に当たりうる【未確認】。この読み方をとるかは、まだ決めていない。上の見直しのときに一緒に決める
- 本番の SNS_INSIGHTS に x が入っているか（1 の X の数字があるか）は、2026-11-19 の時点で確かめていない【未確認】

## 残り

1. ~~X で消された投稿の記録~~: 済み（architecture.md の 4.19）
2. **Developer Console の欄**: Website URL に本番の URL を入れる。Terms・Privacy の欄があれば /terms と /privacy を入れる（欄があるかは【未確認】。画面で確かめる）

## オーナーの作業

| # | どこで | やること |
|---|---|---|
| X-1 | console.x.com → アプリ → Settings | App name を「Yabumi」など、Dev を含まない名前にする。Description に「Social media scheduling tool for people who want to promote their products or services, such as small business owners, online sellers, creators, and app developers. Users write posts, review them, and publish or schedule them to their own X account.」（D34 の位置づけ。2026-11-15 に「for indie app developers」から直した） |
| X-2 | 同上 | Website URL を本番の URL に。Terms of service・Privacy policy の欄があれば `https://yabumi.app/terms`・`/privacy` |
| X-3 | 同上 → User authentication settings | Callback URI に本番の URL があること（deploy.md の 6-4） |
| X-4 | Billing | Spending limit が yabumi の月の上限（X_MONTHLY_BUDGET_USD。投稿と数字の読み取りで共有）より少し上か確かめる。他の人が使い始めると、yabumi 全体の $3 はすぐ届くので、人数に合わせて上限を見直す（PM の「利用者数ごとの費用」） |
