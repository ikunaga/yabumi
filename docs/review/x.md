# X の審査と規約上の準備

- **作成日**: 2026-10-11
- **前提**: 従量課金（pay-per-use）、OAuth 2.0 + PKCE、スコープは tweet.read・tweet.write・users.read・offline.access（architecture.md の 4.13）

## 審査は要るか

- **要らない**（と読める）。従量課金でアプリを作れば、他の人もそのアプリを認可できる。他の人のアカウントをつなぐための審査や、つなげる人数の上限は、公式の資料に書かれていない【未確認: 書かれていないことの確認】
- 守ること（[Developer Policy](https://docs.x.com/developer-terms/policy)）: 使い道を大きく変えたら X に知らせる / 同じ使い道でアプリを複数登録しない / 開発用のアプリを本番に使わない（いまは 1 つのアプリにローカルと本番のコールバックを並べている。これは「開発用を本番に使う」には当たらないが、アプリの名前に「Dev」などを付けない）

## 規約上、矢書に要るもの（他の人のアカウントに投稿するアプリとして）

出典: [Developer Policy](https://docs.x.com/developer-terms/policy)、[Developer Agreement](https://docs.x.com/developer-terms/agreement)（2026-04-27 改定）、[Developer Guidelines](https://docs.x.com/developer-guidelines)

| 決まり | 矢書の対応 | 状態 |
|---|---|---|
| 投稿の前に、本人のはっきりした同意を得る（ログインしただけでは同意にならない） | 投稿は、利用者が「今すぐ送る」「予約」を押したときだけ | 済み |
| 投稿する前に、送る中身をそのまま見せる | 作成画面の SNS ごとのプレビュー（文字数と本文） | 済み |
| プライバシーポリシーを、登録・利用を始める前に見せる。集めるもの・使い道・X を含む渡す先・連絡先を書く | /privacy（登録の画面からリンク、同意の一文）。X への送信を書いた | 済み（連絡先は「確認中」） |
| X のパスワードを聞かない・持たない | OAuth だけ | 済み |
| 矢書の名前をはっきり出し、X と提携しているように見せない | 画面の名前は矢書。X の名前は送り先の表示にだけ使う | 済み |
| 同じ・ほとんど同じ内容を、複数の X アカウントに投稿しない | 1 つの投稿の X の送り先は 1 つ（プロジェクトにつないだアカウント）。別のプロジェクトに同じ文を手で送ることは止めていないので、利用規約で禁じた | 済み（規約） |
| 求められていない @メンションを自動でしない | 矢書は文面を勝手に足さない。AI のネタ出しにも @ を入れさせない | 済み |
| AI が作った**返信**を送るには X の事前の承認が要る | 矢書は返信を作らない（投稿だけ。AI の下書きは利用者が直してから送る） | 対象外。返信の機能を作るなら先に申請する |
| 利用者や X から求められたら、保存した X のデータを 24 時間以内に消す | 「外す」・退会ですぐ消す（architecture.md の 4.14） | 外すは実装担当が作成中 |
| 元の投稿が消えたら、保存した X の投稿も消すか直す | 矢書が持つのは、矢書から送った投稿の ID と URL だけ。X で消された投稿の扱いは architecture.md の 4.19 | 済み（4.19） |
| X のデータでモデルを学習しない | 学習しない。Anthropic にも X から取ったデータは送らない | 済み |
| 自動化アカウントのラベル（Automated） | 利用者が自分のアカウントに予約して送る使い方は bot に当たらないと読める【未確認】 | 様子を見る |

## 残り

1. ~~X で消された投稿の記録~~: 済み（architecture.md の 4.19）
2. **Developer Console の欄**: Website URL に本番の URL を入れる。Terms・Privacy の欄があれば /terms と /privacy を入れる（欄があるかは【未確認】。画面で確かめる）

## オーナーの作業

| # | どこで | やること |
|---|---|---|
| X-1 | console.x.com → アプリ → Settings | App name を「Yabumi」など、Dev を含まない名前にする。Description に「Social media scheduling tool for indie app developers. Users write posts, review them, and publish or schedule them to their own X account.」 |
| X-2 | 同上 | Website URL を本番の URL に。Terms of service・Privacy policy の欄があれば `https://yabumi.app/terms`・`/privacy` |
| X-3 | 同上 → User authentication settings | Callback URI に本番の URL があること（deploy.md の 6-4） |
| X-4 | Billing | Spending limit が矢書の月の上限（X_MONTHLY_BUDGET_USD）より少し上か確かめる。他の人が使い始めると、矢書全体の $3 はすぐ届くので、人数に合わせて上限を見直す（PM の「利用者数ごとの費用」） |
