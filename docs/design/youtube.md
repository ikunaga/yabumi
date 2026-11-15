# YouTube の連携（設計メモ）

- **作成日**: 2026-11-15（実装担当2。PM の依頼）。同じ日に、同意の記録を post_targets の列から別の表 post_target_youtube に直した（PM の指示。TikTok の post_target_tiktok にそろえる）
- **いまの状態**: 設計だけ。コードは PM の了承のあと
- **前提**
  - docs/architecture.md の 4.24（2026-10-11 の調べ。V1〜V5）、docs/review/youtube.md
  - 作りの手本は docs/design/tiktok.md（つなぐ・外す、送る画面、予約の守り、法務 ②、審査の段取り）
  - 動画の仕組み（ブラウザで形をそろえる・post-videos・TUS・media_files の kind = video）は実装担当1 の docs/design/video.md（ブランチ docs/video-design。案）。このメモは「**投稿に動画が 1 本、Storage にある**」ことを前提にする。受け渡しの形は 2026-11-15 に実装担当1 と合わせた（下の 3.1）
- **出典**: Google の公式の資料（2026-11-15 に読み直した）
  - [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)・[videos（リソース）](https://developers.google.com/youtube/v3/docs/videos)
  - [再開できるアップロード](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
  - [割り当ての計算](https://developers.google.com/youtube/v3/determine_quota_cost)・[はじめに](https://developers.google.com/youtube/v3/getting-started)・[改訂履歴](https://developers.google.com/youtube/v3/revision_history)
  - [YouTube の認可とスコープ](https://developers.google.com/youtube/data/guides/authentication)
  - [OAuth 2.0（Web サーバーのアプリ）](https://developers.google.com/identity/protocols/oauth2/web-server)・[OAuth 2.0 の概要（テスト中の 7 日）](https://developers.google.com/identity/protocols/oauth2)・[RISC（Cross-Account Protection）](https://developers.google.com/identity/protocols/risc)
  - [確認の要件](https://support.google.com/cloud/answer/13464321)・[未確認のアプリ・テストのユーザー](https://support.google.com/cloud/answer/15549945)
  - [YouTube API Services の開発者ポリシー](https://developers.google.com/youtube/terms/developer-policies)・[API Services の利用規約](https://developers.google.com/youtube/terms/api-services-terms-of-service)
  - [ショートの長さ](https://support.google.com/youtube/answer/15424877)・[アップロードできるファイル](https://support.google.com/youtube/answer/71673)
- 2026-10-11 の調べから変わったことは【変わった】、資料で確かめられなかったことは【未確認】と書く

### 2026-10-11 から変わったこと（まとめ）

| いつ | 変わったこと | このメモへの影響 |
|---|---|---|
| 2026-11-02【変わった】 | **未確認の API プロジェクトから上げた動画も、非公開に固定されなくなった**（改訂履歴「no longer restricted to private viewing mode」。videos.insert の説明も同じ） | 4.24 の「資料が食い違う」は解けた。7. は「固定されない前提で作り、最初の 1 本で確かめる」に変える |
| 2026-10-15【変わった】 | 子ども向け（selfDeclaredMadeForKids）などは「送ったときだけ変わり、送らなければ変わらない」と書き足された | 毎回必ず送る（4.） |
| 2026-11-03【変わった】 | ショートにもカスタムのサムネイルを上げられるようになった | 使わない（4.24 のとおり、サムネイルは送らない） |
| 2025-12-04・2026-06-01 | アップロードの消費が約 1,600 → 約 100 ユニット、のち **videos.insert は専用の枠で 1 日 100 回** | 4.24 に書いたとおり。変わっていない |
| ― | OAuth の確認の日数の目安が、いまの資料に書かれていない | 4.24 の「3〜5 営業日（FAQ は 10 営業日）」は【未確認】に戻す |

## 0. オーナーに決めてもらうこと（おすすめ順）

| # | 決めること | 選択肢 | おすすめ | 理由 |
|---|---|---|---|---|
| Y1 | スコープを youtube.upload だけにするか | ① youtube.upload だけ ② **youtube.upload ＋ youtube.readonly** | **②** | ① だけだと、つないだ時点でチャンネル名を出せない（channels.list が youtube.upload で読めるかは【未確認】。読めない見込み）。素人は Google のアカウントとチャンネル（ブランドアカウント）を取り違えやすく、「どのチャンネルに送るか」を送る前に見せたい。チャンネルを持っていない人を、つなぐときに見分けられる。上げた動画の処理の状態（processingDetails）を読むのにも使う。どちらも sensitive の見込みで（【未確認】。Cloud Console で確かめる）、確認の手間は増えない。読んだチャンネル名は 30 日ごとに読み直す（開発者ポリシー） |
| Y2 | 予約をどう送るか | ① **yabumi の予約の時刻に上げる** ② 先に上げて YouTube の予約公開（publishAt）に任せる | **①** | ② は上げたあとに予約を変える・やめるのに videos.update・videos.delete が要り、youtube.upload では足りない見込み（【未確認】）。yabumi の画面で予約を動かしても YouTube が古い時刻に公開してしまう。① なら、いまの予約（ほかの SNS と同じ）のまま動き、取り消しも「まだ送っていない」で済む。弱みは、YouTube の処理（数分）だけ公開が遅れること（画面に書く） |
| Y3 | 割り当て（プロジェクト全体で 1 日 100 本）に当たったとき | ① **送らずに失敗にし、要確認で知らせる** ② 次の枠（日本時間 16 時か 17 時）まで待って自動で送る | **①** | ② は利用者の知らないうちに公開の時刻が変わる（開発者ポリシーの「利用者が最後まで決める」に合いにくい）。① なら「明日送る」「手で投稿する」を利用者が選べる。あわせて、利用者ごとに 1 日 5 本まで（6.） |
| Y4 | 「YouTube は手で投稿する」を作るか（X・TikTok と同じ） | ① **作る** ② 作らない | **①** | 枠がいっぱいの日・テスト中に 7 日で許可が切れたとき・確認の前に、YouTube に出したい人の逃げ道になる。X の作り（X_BY_HAND）を広げるだけで、手間は小さい（12.） |
| Y5 | yabumi から YouTube の動画を「取り消す」か | ① **取り消さず、YouTube Studio へ案内する** ② youtube（広いスコープ）を足して取り消す | **①** | 取り消し（videos.delete）は youtube.upload では足りない見込み（【未確認】）。広いスコープ（チャンネルの管理）を求めると、確認の説明が難しくなり、利用者も不安になる。投稿の画面の「取り消す」は、YouTube だけ「YouTube Studio で削除してください」とリンクを出し、消したら「SNS で消した」と記録する（いまの sns_removed_at） |
| Y6 | 公開範囲の初め | ① **何も選んでいない（選ぶまで送れない）** ② 非公開を選んだ状態 | **①** | 開発者ポリシー（docs/review/youtube.md）の「公開範囲を勝手に決めない」。TikTok と同じ扱いにそろえる |
| Y7 | Google Cloud のプロジェクト | ① Play 用（M6）と同じ ② **YouTube 用に別に作る** | **②** | 4.24 の V4 と同じ。OAuth の確認と人数の上限はプロジェクト単位なので、Play の連携を巻き込まない |

- 費用（Supabase Pro）と動画を出す時期は、4.24 の V1・V2（動画の担当のメモ）で決める。YouTube だけで増える費用はない（13.）
- 法務の「前もって知らせる期間を置くか（noticeWaived）」は、施行の時点の利用者で PM・オーナーが決める（10.）

## 1. Google Cloud のプロジェクトと、オーナーの作業

| 順 | すること | 中身 |
|---|---|---|
| 1 | Search Console | yabumi.app を「ドメイン」で足し、Cloudflare の DNS に TXT を入れて確かめる（`vercel.app` は自分のドメインにならない。docs/review/youtube.md） |
| 2 | プロジェクトを作る | 名前 `yabumi-youtube`（Play 用とは別。Y7）。YouTube Data API v3 を有効にする |
| 3 | 同意の画面（Google Auth Platform） | 種類は「外部」。アプリ名 Yabumi、サポートのメール、ロゴ、ホームページ `https://yabumi.app/`、プライバシーポリシー `https://yabumi.app/privacy`、利用規約 `https://yabumi.app/terms`、承認済みドメイン `yabumi.app` |
| 4 | データへのアクセス（スコープ） | `https://www.googleapis.com/auth/youtube.upload`（Y1 が ② なら `.../youtube.readonly` も）。**この画面で sensitive か restricted かの表示を確かめ、PM に知らせる**（資料では確かめられなかった） |
| 5 | テストのユーザー | オーナーの Google アカウントを足す（100 人まで）。公開の状態は「テスト中」のまま |
| 6 | OAuth クライアント | 種類「ウェブ アプリケーション」。承認済みのリダイレクト URI: `https://yabumi.app/sns/youtube/callback`（ローカルで試すなら `http://localhost:3100/sns/youtube/callback` も。Google は localhost の http を許す） |
| 7 | 環境変数（Vercel の Production と Preview、ローカルの .env.local。値は画面にもログにも出さない） | `YOUTUBE_CLIENT_ID`・`YOUTUBE_CLIENT_SECRET`・`YOUTUBE_OAUTH_TESTING`（テスト中は true。7 日の案内を出す）・`YOUTUBE_DAILY_UPLOADS`（全体の 1 日の上限。既定 90。監査で増えたら上げる） |
| 8 | 最小の作りができたら | デモ動画を撮り、公開の状態を「本番」にして OAuth の確認を申請（11.）。並行して割り当ての監査（11.） |

## 2. つなぐ・外す

### 2.1 つなぐ（OAuth。Web サーバーの流れ）

- **入口**: `/sns/youtube/connect?project=<id>` → `https://accounts.google.com/o/oauth2/v2/auth`
  - client_id、redirect_uri、response_type=code、scope（Y1 のもの。空白区切り）
  - **state**: 既存の src/lib/sns/oauth-state.ts（cookie の乱数・利用者・プロジェクト・10 分）
  - **PKCE**: code_challenge（S256）と code_verifier を X と同じく state の cookie に入れる。Web サーバーの資料には PKCE の記載がないが、Google の OpenID の設定（discovery）は S256 に対応と書いている。client_secret と併せて使う（効かなかったら外すだけ。【未確認】作るときに確かめる）
  - **access_type=offline**（リフレッシュトークンをもらう）、**prompt=consent**（つなぎ直しでも必ずリフレッシュトークンが返るように）、include_granted_scopes は付けない（ほかの許可を混ぜない）
- **戻り先**: `/sns/youtube/callback`。state を確かめ、code を `https://oauth2.googleapis.com/token` で換える（サーバーだけ）
  - 返ってきた scope を確かめる。利用者は一部のスコープだけを許可できる（資料）。**youtube.upload がなければ、つながずに**「YouTube への投稿を許可してください」と出す。Y1 が ② で readonly がなければ同じく断る
- **チャンネルを読む**（Y1 が ②）: `channels.list?part=snippet&mine=true`
  - チャンネルがない → つながずに「YouTube のチャンネルを作ってから、もう一度つないでください」（YouTube の作り方へのリンク）
  - social_accounts（sns = 'youtube'）: external_id = チャンネル ID、display_name = チャンネル名、handle = customUrl（@ハンドル。なければ空）
  - アイコンの URL は保存しない
- Y1 が ① のとき: チャンネル名は最初に送った videos.insert の答え（snippet.channelTitle）で埋める。それまでは「YouTube（Google のアカウント）」と出す

### 2.2 トークン

- アクセストークン 1 時間。リフレッシュトークンは使い捨てではない（X と違う）。social_account_tokens に暗号化して入れる（既存）
- 取り直し: アダプターの refreshWithRefreshToken（X と同じ形）。送る直前に期限を見て取り直す。同時に取り直しても困らないが、既存の refresh_locked_until の鍵はそのまま使う
- **30 日ごとの確かめ**（開発者ポリシー「30 日ごとに、まだ許可されているか確かめる」「保存したデータは 30 日で消すか読み直す」）: 既存の refreshDueTokens（毎日）に YouTube を足し、**7 日に 1 回**トークンを取り直し、チャンネル名を読み直す。取り直しで invalid_grant → 外されたと見なす（2.4）
- **テスト中（YOUTUBE_OAUTH_TESTING=true）は、許可が 7 日で切れる**（リフレッシュトークンも。資料）
  - つないだ日時から 7 日後を「つなぎ直しの目安」として、設定の「つないだ SNS」に出す: 「YouTube は 11/22 までにつなぎ直してください（yabumi が Google の確認を受けている途中のため、7 日ごとにつなぎ直しが要ります。あなたのアカウントの問題ではありません）」
  - 切れたら（invalid_grant）既存の「期限切れ」と同じく要確認に「つなぎ直しが要ります」
  - 予約が切れる日より後にあるときは、予約を決めるときに「この日までにつなぎ直さないと送れません」と出す（止めはしない）
  - 確認が済んだら YOUTUBE_OAUTH_TESTING を false にすれば、案内が消える

### 2.3 外す（yabumi の「外す」）

- `https://oauth2.googleapis.com/revoke` にリフレッシュトークンを送る（このプロジェクトに許したすべてのスコープが取り消される。資料）。revokeSnsAccess に YouTube を足す
- 取り消しが失敗しても、yabumi の側のトークンは消す（いまの X と同じ）
- social_accounts を消し、purgeSnsDataOf（9.）。**7 日以内に消す**の決まりは、その場で消すので満たす

### 2.4 Google の側で取り消されたとき

- 知る方法
  1. 取り直し（送る直前・7 日に 1 回）の invalid_grant。**これを基本にする**（30 日以内に消す決まりを、7 日ごとの確かめで満たす）
  2. RISC（Cross-Account Protection）の token-revoked など。サービスアカウント・署名つき JWT の受け口が要り、**利用者が Google の設定でアプリを外したときに届くかが資料に書かれていない【未確認】**。最初は作らない
- invalid_grant のときは「期限切れ」にして要確認で知らせ、**30 日たってもつなぎ直されなければ**、トークンと 9. のデータを消す（Google の設定で取り消された場合は 30 日以内に消す決まり）。テスト中の 7 日切れも同じ invalid_grant で区別できないので、同じ扱いでよい

## 3. 送る：再開できるアップロード

### 3.1 動画の受け渡し（実装担当1 と合わせた形。docs/design/video.md の案）

- `postVideoFor(admin, postId) → null | { mediaId, sizeBytes, mime: "video/mp4", durationMs, width, height, aiGenerated, readRange(start, endExclusive) }`（src/lib/media/video-store.ts。サーバーだけ）
  - 投稿に添えた動画だけを返す（ID の取り違えで他人の動画を読まない）
  - readRange は短い署名 URL に Range を付けて読む（URL は最初に 1 回作り、5 分使い回す）。Range が効かなければ、1 回目に全体を読んで持ち、2 回目からは読み直さない
  - width・height は回転を当てたあとの見た目の縦横
- 動画を消すのは、配信先に pending・preparing・publishing が 1 つもなくなって 1 日たってから（failed が残るときは 7 日）。**YouTube の配信先が preparing（アップロードの途中）の間は消さない**

### 3.2 流れ（いまの「準備中」の 2 段階の送り方を使う。src/lib/sns/adapters/staged.ts）

```
startPublish（送る時刻が来た回）
  → 割り当てを取る（6. の reserve。取れなければ送らずに failed）
  → セッションを始める: POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
       X-Upload-Content-Length: sizeBytes、X-Upload-Content-Type: video/mp4、本文は動画の情報（4.）
     → 答えの Location がセッションの URL
  → セッションの URL を youtube_uploads に暗号化して入れる（8.）
  → 8MB ずつ（256KB の倍数）PUT。Content-Range: bytes 始め-終わり/合計
       308 → 続き。Range の答えで、受け取られた所から次を送る
       200・201 → アップロード完了。答えの id が動画の ID
  → この回の残り時間が 10 秒を切ったら、送った所までを記録して preparing（次の回に続き）
continuePublish（次の回から）
  → 空の PUT（Content-Range: bytes */合計）で、どこまで受け取られたかを聞く
       308 → Range の続きから送る
       200・201 → 完了（最後の答えが届かなかったときも、ここで動画の ID がわかる）
       404 → セッションが切れた。アップロードは済んでいないので動画はできていない。割り当てを取り直してセッションからやり直す
```

- **完了した時点で published にする**（external_post_id = 動画の ID、URL は `https://www.youtube.com/watch?v=<ID>`。ショートでも開ける）。これより後は、二度と上げ直さない
- **二重に上げない**: 完了の答えが通信の途中で消えても、次の回の「どこまで受け取られたか」で完了がわかる。いまの publisher の「準備に 15 分かかったら最初から送り直す」（PREPARE_TIMEOUT_MS）は、YouTube では使わない（アダプターに「最初からやり直してよいか」を持たせ、YouTube は「セッションが切れた（404）ときだけ」にする）
- やり直し: 500・502・503・504 は間をあけてやり直す（Retry-After があれば従う）。ほかの 4xx は permanent。401 は取り直してから 1 回だけ。`uploadLimitExceeded`（利用者ごとの YouTube の上限。数は公開されていない【未確認】）は failed で「YouTube の 1 日の上限に達しました。明日送るか、YouTube のアプリから投稿してください」。`quotaExceeded` は 6.
- セッションの URL がいつまで使えるかは、資料に「いずれ切れる」とだけある【未確認】。切れたら 404 でやり直すので、長さに頼らない

### 3.3 Vercel の時間に収まるか

- 送信ジョブは Hobby の 60 秒、1 回 40 秒（JOB_DEADLINE_MS）で切り上げる
- 動画は 50MB まで（Supabase Free の上限。4.24）。Storage から読んで Google に送るのは、どちらも速い回線なので 1 本 10〜20 秒の見込み（【未確認】作るときに測る）。収まらなくても、上の「続きから」で次の回（1 分後）に送る
- 1 回のジョブで YouTube のアップロードは **1 本だけ**始める（ほかの SNS の送信の時間を食わないため）。2 本目は次の回（deferred）
- メモリ: 8MB ずつ読むので小さい。Range が効かずに全体を持つときも 50MB

### 3.4 送ったあとの処理の確かめ

- 完了したら published にしたうえで、youtube_uploads に processing の確かめを残し、送信ジョブが次の回から `videos.list?part=status,processingDetails&id=<ID>` を読む（Y1 が ② のとき。① のときは読めるか【未確認】で、読めなければ確かめない）
  - uploadStatus が processed・processingStatus が succeeded → 確かめ終わり
  - uploadStatus が rejected・failed、processingStatus が failed・terminated → 配信先を failed にし、理由（rejectionReason・failureReason）を日本語にして要確認に出す。動画は YouTube にあるので「YouTube Studio で確かめてください」
  - 30 分たっても processing → 確かめをやめる（published のまま）
- 画面: 完了から確かめ終わりまで、投稿の画面の YouTube に「YouTube で処理しています（数分かかることがあります）」

## 4. 送る画面

YouTube を送り先に選んだ投稿の、② 送り先の YouTube の欄（選んだときに開く）と ⑤ 送るに出す。

| 項目 | 決まり | yabumi の扱い |
|---|---|---|
| タイトル | 100 字まで。`<` `>` は使えない | **必須**。post_targets.title（note・Substack・TikTok と同じ列）。共通の本文からは自動で作らない（空のまま）。AI で投稿に整える（4.34）で YouTube を選んだときだけ案を出す |
| 説明 | **5,000 バイト**まで（字ではない）。`<` `>` は使えない | YouTube の文面（body_override か共通の本文）。字数の数え方を YouTube だけバイトにする（src/lib/sns/index.ts の maxLength を「バイト」で数える）。`<` `>` があれば、送る前の確かめで「YouTube では < と > を使えません」 |
| タグ（ハッシュタグ） | 説明に書いた #タグ は YouTube のハッシュタグになる。tags（検索用のタグ）は合計 500 字 | yabumi のタグの欄（post_targets.hashtags）は、ほかの SNS と同じく説明の後ろに #タグ で付ける。検索用の tags は最初は送らない（素人には違いがわかりにくく、効き目も小さい） |
| 公開範囲 | public・unlisted・private。送らないと public | **利用者が選ぶ。最初は何も選んでいない**（Y6）。「公開（だれでも見られる）」「限定公開（URL を知っている人だけ）」「非公開（自分だけ）」 |
| 子ども向けか | selfDeclaredMadeForKids。COPPA のため、すべての動画で決める。送らなければ変わらない（2026-10-15【変わった】） | **必須の 2 択（はい・いいえ）。最初は選んでいない**。「?」に「子ども（13 歳未満）向けに作った動画なら『はい』。『はい』にするとコメントなどが使えなくなります」 |
| 改変・合成したコンテンツ | status.containsSyntheticMedia（2024-10-30 から。「本物と見分けにくい改変・合成」を申告する） | スイッチ。最初は**オフ**。添えた動画が AI で作ったもの（media_files.ai_generated）なら**オン**にして「AI で作った動画なので、YouTube に申告します」と出す（利用者がオフに戻せる。申告が要るのは本物らしく見えるときだけなので、決めるのは利用者） |
| カテゴリ | snippet.categoryId。insert で必須かは【未確認】 | 必ず送る。初めは「ブログ（22）」。選べるのは videoCategories.list?regionCode=JP の答えのうち、よく使う 6 つほど（ブログ・ハウツーとスタイル・教育・エンターテイメント・科学と技術・ペットと動物）。一覧は 30 日ごとに読み直す |
| 登録者への通知 | notifySubscribers。初めは true | 送らない（初めのまま）。画面にも出さない |
| ショート | API に「ショートにする」項目はない。**3 分以内で、正方形か縦長**なら自動でショート | 欄の下に 1 行: 動画が条件に合えば「この動画は YouTube ショートとして出ます（3 分以内・縦長）」、合わなければ「ふつうの動画として出ます（ショートにするには、3 分以内の縦長か正方形の動画にしてください）」。判定は postVideoFor の durationMs・width・height。API で上げたものにも当てはまるかは【未確認】（9. の段で確かめる） |

- **同意**（開発者ポリシー「書き込みの前に、はっきり同意をもらう」「公開されるものは利用者が最後まで決める」）: ⑤ 送るの YouTube の欄に、チャンネル名（Y1 が ②）・タイトル・公開範囲・子ども向け・改変の申告を並べ、「この内容で <チャンネル名> に送ります」。送る・予約するのボタンがこの同意を兼ねる
- yabumi は説明に文を足さない。ロゴや透かしを付けない
- YouTube の利用規約へのリンク（「YouTube に送ると、YouTube 利用規約に従うことになります」）を欄の下に小さく出す（開発者ポリシーの「YouTube の規約へのリンクを出す」）

## 5. 予約（Y2）

- **おすすめ: yabumi の予約の時刻にアップロードを始める**（ほかの SNS と同じ送信ジョブ）。publishAt は使わない
  - 理由: 上げたあとに予約を変える・やめるには videos.update・videos.delete が要り、youtube.upload では足りない見込み（【未確認】）。yabumi の画面で予約を動かしても、YouTube が古い時刻に公開してしまう／yabumi の予約の作り（取り消し・動かす・要確認）をそのまま使える／同意した中身と送る中身がずれない
  - 弱み: YouTube の処理（数分）だけ、公開が予約の時刻より遅れる。予約の画面の YouTube に「予約の時刻にアップロードを始めます。YouTube での公開は数分遅れることがあります」と出す
- 予約を決めるとき（savePost）に、送る中身（公開範囲・子ども向け・申告・カテゴリ、タイトルと説明の指紋、チャンネル名）を post_target_youtube に記録し（8.）、送るときはその中身だけを送る。予約のあとに文を変えたら、保存し直し（同意し直し）になる。送る直前に、指紋とチャンネル名を照らし、違えば送らずに failed と要確認（「YouTube に送る内容が予約のときと変わったので、送りませんでした。投稿の画面で確かめてから、もう一度送ってください」）
- 予約の時刻に、つなぎ直しが要る（テスト中の 7 日切れ・取り消し）ときは failed にして要確認（既存の「つながりが切れています」）

## 6. 割り当て（videos.insert は 1 日 100 回・プロジェクト全体）

- 枠は太平洋時間の 0 時に戻る（日本時間 16 時。夏時間の間は 17 時）【未確認】Cloud Console の表示で確かめる
- **yabumi の中で数える**（Google の残りを API で聞く手段はない）
  - 送る前に `reserve_youtube_upload(owner_id, post_target_id)`（security definer。service_role だけ）で 1 本ぶんを取る。太平洋時間の今日の数を数え、**全体が YOUTUBE_DAILY_UPLOADS（既定 90。10 本は手での試しや余り）**、**利用者ごとに 5 本**を超えるなら取らない。同時に何本送っても超えないよう、advisory lock で順にする（reserve_sns_spend と同じ考え方）
  - 記録は sns_api_usage（sns = 'youtube'、operation = 'upload'、cost_usd = 0）に入れる（片付け〈13 か月〉と本人だけ読める作りをそのまま使う）。セッションからやり直す（404）ときは、もう 1 本ぶん取る（数えすぎる側に倒す）
- **当たったとき**（Y3）: 送らずに failed、要確認と通知に
  - 全体: 「今日の YouTube の送信の枠（yabumi 全体）がいっぱいです。日本時間の 16 時を過ぎてから送り直すか、手で投稿してください」
  - 利用者: 「YouTube は 1 日 5 本まで送れます。明日送り直すか、手で投稿してください」
  - Google から quotaExceeded が返ったとき（数えずれ）も、全体と同じ文
- 予約を決めるときに、その日（太平洋時間）にすでに 5 本の予約があれば「この日は YouTube の上限（1 日 5 本）を超えます」と出して保存しない
- 全体の数が 1 日 50 本を超える日が出てきたら、割り当ての監査を申請する（11.。roadmap に目安を書く）

## 7. 未確認のアプリで上げた動画が非公開に固定されるか

- **2026-11-02【変わった】: 固定されなくなった**（改訂履歴「Videos uploaded through the videos.insert method from unverified API projects are no longer restricted to private viewing mode」。videos.insert の説明も「not restricted」）。4.24 の食い違いは、固定されない側で解けた
- それでも念のため、9. の段（本物に送る）で最初の 1 本を「限定公開」で上げ、videos.list で status.privacyStatus が unlisted のままかを確かめる
- もし非公開に固定されていたら（答えの privacyStatus が選んだものと違う）:
  - その配信先は published のまま、投稿の画面に「YouTube の側の決まりで、いまは非公開で公開されています。YouTube Studio で公開範囲を変えられます」
  - 環境変数で「非公開だけ」に切り替え（公開範囲の選択肢を非公開だけにし、送る画面の上に TikTok と同じ形の帯「yabumi の準備の都合で…」）、監査を急ぐ

## 8. 表・列・RLS・grant

既存の SNS に合わせる。

- **social_accounts・social_account_tokens**: そのまま（sns = 'youtube'）。トークンは暗号化、サーバーの権限だけが読む
- **新しい表 post_target_youtube**（送るときに利用者が選んで同意した設定。配信先ごとに 1 行。feat/tiktok の post_target_tiktok〈20261114120000〉と名前と形をそろえる）
  - post_targets に列を足さない理由: post_targets は利用者の権限で表ごと select を許している。列を足すとその列も読めてしまい、列ごとの grant に組み直すと select * しているところが壊れる（TikTok で決めたこと）
  - 列:
    - post_target_id（主キー、post_targets に on delete cascade）・owner_id（auth.users に on delete cascade）
    - privacy_status text not null check（'public'・'unlisted'・'private'）
    - made_for_kids boolean not null（初めの値を置かない。選ぶまで保存しない）
    - synthetic_media boolean not null default false
    - category_id text not null check（数字だけ、3 字まで）
    - consented_at timestamptz not null（サーバーが now() を入れる）
    - consent_text_hash text not null check（SHA-256 の 16 進 64 字）: 同意したときのタイトルと説明の指紋。送る直前の文と違えば送らない（tiktok.md の 4. と同じ）
    - consent_channel text not null check（100 字まで）: 同意したときのチャンネル名（Y1 が ②）。送る直前に読み直したチャンネル名と違えば送らない（別のチャンネルにつなぎ直したとき）
    - updated_at
  - タイトルは post_targets.title、説明は body_override（既存の列。いまの列ごとの grant のまま）
  - RLS を有効にし、ポリシーは置かない。`revoke all ... from anon, authenticated`、service_role にだけ select・insert・update・delete を grant（post_target_tiktok と同じ）
  - 書くのは savePost（zod で確かめ、サーバーの権限で）。画面に戻すとき（下書きの再開・投稿の画面）も、サーバーが持ち主を確かめて読む（tiktok の loadTikTokTarget と同じ形の loadYouTubeTarget）
  - 持ち主をそろえるトリガー: 配信先が同じ持ち主の YouTube の配信先であること（tiktok_check_owner と同じ。共通の関数にするか、YouTube 用を足すかは、作るときに実装担当3 と決める）
- **新しい表 youtube_uploads**（アップロードの途中の情報。サーバーだけ）
  - post_target_tiktok の tiktok_media_tickets と同じく、同意の表とは分ける（消える時期と中身が違うため）
  - post_target_id（主キー、post_targets に on delete cascade）・owner_id（auth.users に on delete cascade）・session_uri_encrypted（セッションの URL は、それだけで続きを送れる鍵に近いので暗号化する【未確認】）・bytes_total・bytes_sent・video_id・processing_checked_until・started_at・updated_at
  - RLS を有効にし、ポリシーは置かない。`revoke all ... from anon, authenticated`、service_role にだけ grant。持ち主をそろえるトリガーも同じく付ける
  - post_targets.sns_container には `{ stage: "uploading" | "processing", bytesSent }` だけを入れる（本人が読める列なので、セッションの URL は入れない）
- **関数 reserve_youtube_upload**（6.）: security definer、`revoke all ... from public, anon, authenticated, service_role` のあと service_role にだけ grant
- **SNS の定義**（src/lib/sns/index.ts）: youtube の maxLength 5000 を「バイト」で数える。タイトル 100 字。maxImages: 0、media: "video"（いまのまま）
- 結合テスト: post_target_youtube・youtube_uploads は本人も他人も利用者の権限で読めず書けない、anon も同じ、ほかの人の配信先や YouTube でない配信先には行を作れない（トリガー）、reserve の上限と同時実行（grants.integration.test.ts の TABLES に 2 つの表を足す）

## 9. 外されたとき・データの削除（purgeSnsDataOf）

- purgeSnsDataOf に youtube_uploads と post_target_youtube の consent_channel（チャンネル名。YouTube から読んだデータ）を足す（行を消すか、チャンネル名を空にする。送り直すには同意し直しが要るので、行ごと消してよい）。ほかは既存のまま（送った動画の ID・URL・sns_container を消す。本文と「送った」記録は残す）
- 消す時期（開発者ポリシー）
  - yabumi で外す・データの削除を求められた: **7 日以内** → その場で消す
  - Google の設定で取り消された: **30 日以内** → 2.4 のとおり、7 日ごとの確かめで気付き、30 日待ってから消す（つなぎ直しを待つ間も 30 日を超えない）
  - 保存した YouTube のデータ（チャンネル名・カテゴリの一覧・動画の ID）は 30 日ごとに読み直すか消す → チャンネル名は 7 日ごとに読み直す。動画の ID は「送った記録」として持つ（利用者が送ったものの記録。30 日ごとの読み直しに当たるかは【未確認】。11. の監査で聞かれたら、送ったあとの処理の確かめのあとは使わないと説明する）
- 既存の /sns/deletion（データの削除の案内）に YouTube を足す: 「Google のアカウントの設定（https://security.google.com/settings/security/permissions）から yabumi へのアクセスを取り消せます」
- 退会: 2.3 の取り消しをしてから、cascade で消える

## 10. 法務（② として扱う）

新しい送り先・新しく預かる情報なので ②。docs/legal.md に ② と理由を記録し、LEGAL_VERSIONS に版を足す。前もって知らせる期間（noticeWaived）は、施行の時点の利用者で PM・オーナーが決める。URL は作るときに開いて確かめる。

- **プライバシーポリシーに足す文の案**
  - YouTube API サービス: 「yabumi は、YouTube に動画を送るために YouTube API サービスを使います。YouTube をつなぐと、Google のプライバシーポリシー（http://www.google.com/policies/privacy）も適用されます」
  - 預かる情報: 「YouTube のアカウント: チャンネルの ID、チャンネル名、ハンドル、アクセストークンとリフレッシュトークン（暗号化して保存）。YouTube に送るときに選んだタイトル・説明・公開範囲・子ども向けかどうか・改変や合成の申告・カテゴリと、送ることに同意した日時。送った動画の ID」
  - 使い道: 「あなたが選んだ動画を、あなたが選んだ設定で、あなたの YouTube のチャンネルに送るため。送ったあとに、YouTube での処理が終わったかを確かめるため。チャンネル名は、送り先を確かめられるよう画面に出すため」
  - 送り先（第 3 条）: 「YouTube（Google LLC）: 動画、タイトル、説明、タグ、公開範囲などの設定、アクセストークン」
  - 保存期間: 「YouTube のアカウントとトークン: 外すか退会まで。Google の設定で取り消されたときは、気付いてから 30 日以内に消します。チャンネル名は 7 日ごとに読み直します。アップロードの途中の情報: 送り終えたら使わず、投稿と一緒に消えます」
  - 取り消し方: 「yabumi の設定の『外す』か、Google のセキュリティの設定（https://security.google.com/settings/security/permissions）から、yabumi へのアクセスをいつでも取り消せます。取り消すと、yabumi は YouTube から受け取った情報を 7 日以内（Google の設定で取り消したときは 30 日以内）に消します」
- **利用規約に足す文の案**: 「YouTube に送るときは、YouTube 利用規約（https://www.youtube.com/t/terms）に従ってください。公開範囲・子ども向けかどうか・改変や合成の申告は利用者が選び、その内容に責任を持ちます」
- 画面: 「YouTube をつなぐ」の前と、送る画面の YouTube の欄に、YouTube 利用規約と Google のプライバシーポリシーへのリンク（開発者ポリシーの「リンクを出す」）
- 2026-11-15 の版（SNS のコメント）とは別の日の版にする（1 日 1 版）

## 11. 審査

### 11.1 OAuth の確認（sensitive のスコープ）

- 要るもの（確認の要件）
  - **本番に切り替えてから**申請する（テスト中のままでは申請できない）
  - ホームページ: yabumi.app のトップ（ログインの画面だけでなく、アプリの機能を説明している）。Search Console で所有を確かめたドメイン
  - プライバシーポリシー: 同じドメイン。同意の画面とホームページの両方からリンク。中身に 10. の YouTube の文
  - **デモ動画**（YouTube に限定公開で上げる）: 同意の画面を**英語**で出し、アプリ名とアドレスバーの client_id が見えるように。流れ:
    1. yabumi.app にログイン → プロジェクトの設定 → 「YouTube をつなぐ」→ Google の同意の画面（スコープが見える）→ 戻ってチャンネル名が出る
    2. 投稿をつくる → 動画を添える → 送り先に YouTube → タイトル・説明・公開範囲・子ども向け・改変の申告・カテゴリ → ショートの 1 行
    3. ⑤ 送る: チャンネル名と中身の確認 → 今すぐ送る → 「YouTube で処理しています」→ 投稿済み → YouTube Studio で動画が出ていること
    4. 予約: 日時を決めて予約 → 時刻に送られる
    5. 外す: 設定で YouTube を外す（Google の設定からもアクセスが消えていること）
  - **スコープの説明（英語の案）**
    - youtube.upload: "Yabumi lets users prepare a video post (title, description, privacy status, made-for-kids setting, altered or synthetic content disclosure, category), review it, and then upload it to their own YouTube channel, either immediately or at a time they scheduled. Yabumi only uploads videos that the user selected and confirmed. It does not modify or delete existing videos."
    - youtube.readonly（Y1 が ②）: "Yabumi reads the name and handle of the user's own channel so that the user can confirm which channel the video will be uploaded to before posting, and reads the processing status of videos that Yabumi uploaded on the user's behalf so that it can tell the user whether YouTube finished processing the upload. Narrower scopes do not allow reading the channel name."
  - 日数の目安: いまの資料には書かれていない【未確認】（4.24 の 3〜5 営業日は古い FAQ）
  - youtube.upload・youtube.readonly が restricted（CASA が要る）でないことは、1. の 4 で Cloud Console の表示を見て確かめる
- 確認の前（本番で未確認）は「確認されていないアプリ」の警告が出て、新しい利用者は**合計 100 人まで（戻らない）**。テスト中（100 人・7 日）で試し、確認を受けてから他の人に出す

### 11.2 割り当ての監査（API Compliance Audit）

- 1 日 100 本を増やすときだけ要る（2026-11-02 から、公開で上げるのに監査は要らない【変わった】）
- 申請: [Audit and Quota Extension Form](https://support.google.com/youtube/contact/yt_api_form)。増えた割り当ては「認められた使い道」にだけ使える（ポリシー）
- 出すもの（見込み）: 使い道（利用者が自分のチャンネルに自分の動画を送る・予約する）、画面の録画、プライバシーポリシー、データの保存と削除（9.）、1 日の見込みの数
- 目安: 全体で 1 日 50 本を超える日が出てきたら（6.）

## 12. 「YouTube は手で投稿する」（Y4）

- X の「手で投稿する」（X_BY_HAND_MESSAGE・isXByHand。tiktok.md の 17. も同じ）を広げる
  - 送り先の YouTube で「手で投稿する」を選ぶと、予約の時刻に「手で投稿する番」として知らせる
  - 投稿の画面で、タイトル・説明をコピー、動画を保存（ダウンロード）して、YouTube のアプリか YouTube Studio から投稿し、「投稿した」を記録する
  - 要確認の「送れなかった投稿」には数えない（いまの X と同じ）
- 使う場面: 枠がいっぱいの日（6.）、テスト中に 7 日で許可が切れた、確認の前に他の人に出したい、YouTube のアプリで音楽や字幕を付けたい
- 動画を保存させるので、手で投稿する番の配信先がある間は、動画を消さない（3.1 の「pending がある間は消さない」に入る）

## 13. 費用

- YouTube Data API: 料金の記載はなく、割り当て（回数）だけの決まり（利用規約・はじめにに料金の話がない。「無料」とはっきり書いたところは見つからない【未確認】）。Google Cloud のプロジェクトも、API を使うだけなら費用はかからない
- 動画の置き場所と転送: 4.24 の見積もりのとおり（YouTube へは、サーバーが Storage から 1 回読む。4.24 の「1 本あたり 4 回ほど」に含めてある）。**Supabase Pro（$25/月）が要る時期は、動画の利用者の数で決まり、YouTube を足しても変わらない**（4.24 の V2）
- Vercel: 関数から Google に送る分。Hobby の転送量（100GB）に関数の外向きの通信が含まれるかは【未確認】。含まれても、動画の利用者 10 人・1 人月 8 本・40MB で 約 3GB/月
- 割り当てを増やす監査も無料

## 14. 作る順と、テストの案

| 段 | 作るもの | 確かめ |
|---|---|---|
| 1 | つなぐ・外す・取り直し・7 日ごとの確かめ（social_accounts・tokens・state・PKCE・revoke） | 結合: state が違うと断る、スコープが足りないと断る、チャンネルがないと断る、トークンは本人でも読めない、外すと purge、invalid_grant で期限切れ。偽の Google（fetch の差し替え）で |
| 2 | post_target_youtube と保存（savePost の確かめ。タイトル・説明のバイト・< >・公開範囲・子ども向け・申告・指紋・チャンネル名） | 単体: 字数とバイト、< > の確かめ、ショートの 1 行の出し分け、指紋とチャンネル名が違えば送らない。結合: 表を利用者の権限で読めず書けない、consented_at はサーバーが決める、持ち主のトリガー |
| 3 | 割り当て（reserve_youtube_upload・sns_api_usage） | 結合: 全体と利用者ごとの上限、同時に 10 本取っても超えない、太平洋時間の日の切り替わり |
| 4 | アダプター（再開できるアップロード・youtube_uploads・続きから・処理の確かめ） | 単体（偽の Google）: 308 の続き、最後の答えが消えても二重に上げない、404 でやり直し、5xx のやり直し、quotaExceeded・uploadLimitExceeded、40 秒で切り上げて次の回に続き、処理の rejected で failed |
| 5 | 送る画面（4. の欄・同意・ショートの 1 行・テスト中の帯） | 画面（スマホ・PC、明暗。PMO） |
| 6 | 手で投稿する（Y4） | 単体・結合: X と同じ |
| 7 | 法務の版 | 版と本文のテスト |
| 8 | **本物の YouTube に送る**（オーナーの了承のあと。オーナーのチャンネル・限定公開・テスト中） | 7. の非公開の固定、ショートになるか（縦 60 秒）、categoryId を送らないときの扱い、channels.list と videos.list のスコープ、PKCE、セッションの URL を暗号化する要るか、1 本の送る時間 |
| 9 | デモ動画を撮って OAuth の確認を申請 | |

- 本物の YouTube に送るのは 8. の段だけで、オーナーの了承を得てからにする（画面の確かめでは偽の Google を使う。本物の SNS に投稿しない決まり）
- 動画の仕組み（実装担当1）の、postVideoFor と片付け（preparing を数える）ができてから 4. に入る。1〜3 は先に作れる

## 作る前に確かめること（資料で確かめられなかったこと）

- youtube.upload・youtube.readonly が sensitive か restricted か（Cloud Console の表示）
- channels.list・videos.list（自分の動画の処理の状態）が youtube.upload だけで読めるか
- videos.update・videos.delete が youtube.upload で使えないこと（Y2・Y5 の前提）
- Web サーバーの流れで PKCE が効くか
- categoryId が insert で必須か
- 再開できるセッションの URL の長さと、Authorization なしで続きを送れるか（暗号化が要るかの判断）
- 利用者ごとの上限（uploadLimitExceeded）の数
- 割り当ての枠が戻る時刻（太平洋時間の 0 時か）
- 利用者が Google の設定でアプリを外したときに RISC が届くか
- API で上げた縦の 3 分以内の動画がショートになるか
