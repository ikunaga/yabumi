# src/lib/auto-post（自動の投稿）

設計は docs/design/auto-post.md。DB は supabase/migrations/20261116100000_auto_post.sql と 20261116110000_auto_post_ai_budget.sql。
ここは画面（実装担当3）・入口と案（実装担当1）・ジョブ（実装担当2 の feat/auto-post-engine）の境目。

## ファイル

| ファイル | 中身 | 使う人 |
|---|---|---|
| types.ts | 型（AutoPlan・AutoRun・AutoReviewItem・UpcomingAutoRun・ProjectEvent・AutoSample・AutoResult）と、SNS ごとに選べる送り方（TARGET_MODES）・段階 A の使い道と SNS | みんな |
| labels.ts | 画面の言葉（使い道・送り方・回の状態・理由・止まった理由） | 画面 |
| schema.ts | 入力の確かめ（zod）と上限の値 | 画面・アクション |
| schedule.ts | くり返しの規則から送る時刻を出す（dueTimes・nextDueTime・runsPerMonth） | 画面・カレンダー・ジョブ |
| queries.ts | 読み取り（server-only。利用者の権限） | サーバーコンポーネント |
| actions.ts | 操作（"use server"） | 画面 |
| ai.ts | AI の入口と偽の AI（下） | アクション・ジョブ |
| engine.ts | ジョブ（回を足す・作る・期限切れ・止める・知らせる）と見本（makeSample） | ジョブ・見本のアクション |
| materials.ts・prompt.ts・checks.ts・ai-schema.ts | 材料の選び方・AI への指示・送る前のチェック・AI の返事の形 | engine |
| plan-row.ts | DB の行を型にする | queries・engine |

## 読み取り（queries.ts）

- `listAutoPlans(projectId)`・`getAutoPlan(planId)`: 回し方
- `listAutoRuns(planId, limit)`: 回の一覧（新しい順。結果を見る画面）
- `listUpcomingAutoRuns(projectId, from, until)`: カレンダー・ホームに出す、これからの回。ジョブがまだ作っていない回は規則から出す（postId が null・status が waiting）。止めた・飛ばした回は出さない
- `listAutoReviewItems(projectId, { media })`・`countAutoReviewItems(projectId)`: 確かめ待ち（送る時刻の前のもの）。回ごとに、添えた画像（画像の説明つき）・動画を `media` に持つ（`loadReviewMedia`。数えるだけのときは `media: false` で URL を作らない）。SNS ごとに何が届くかは `review-media.ts` の `mediaForSns`（送信ジョブ publisher.ts と同じ決まり）
- `listProjectEvents(projectId)`: お知らせ・季節の予定

## 操作（actions.ts）。どれも `AutoResult`（`{ ok: true, data }` か `{ ok: false, error }`。error は画面にそのまま出せる文）

- `saveAutoPlan(projectId, input)`: 作る・直す。**保存のたびに同意（input.consent = true）が要る**（X の自動化のルール: 機能を変えたら同意し直し）。直すと、まだ作っていない回は新しい設定で作り直す
- `setAutoPlanStatus(projectId, planId, "paused" | "active", toDraft)`・`pauseAllAutoPlans(projectId, toDraft)`: 止める・再開・全部止める。toDraft が true なら、作り終えてまだ送っていない予約を下書きに戻す（false ならそのまま送る）。画面で選んでもらう（初期値 true）
- `skipNextAutoRun(planId)`: 次の回を飛ばす（次の回がまだ決まっていなければ dueAt が null）
- `deleteAutoPlan(planId, toDraft)`: 消す
- `makeAutoSample(projectId, input, { oneTime, fromSampleId })`: テストで 1 件つくる（画面の言葉。コードでは見本〈sample〉。材料は使ったことにしない）。次の回と同じ道（材料 → AI → チェック）で作り、AI を 1〜2 回使う（自動の投稿の枠。作るのは用途 auto_post_sample で 1 人 1 日 5 回まで）。作った見本は auto_samples に 1 日だけ置き、`sampleId` を返す。`oneTime` はその 1 回だけの指示、`fromSampleId` は前の見本と同じ材料で作る（docs/design/auto-sample-image.md の 1.）
- `setAutoPlanInstructions(planId, instructions)`: 書き方の指示だけを直す（回し方の画面の見本から）
- `saveAutoPlan` の `sampleId`（新しく作るときだけ）: その見本を 1 回目として送る（画面は「この投稿を 1 回目として送る」。engine の adoptSample）
- `listEvents`・`saveEvent(projectId, { id?, onDate, body })`・`deleteEvent(projectId, id)`: お知らせ・季節の予定
- `loadAutoPlan(planId)`・`loadAutoTargetPreviews(postId)`: 開き直したときの読み直し

### 確かめる（2 つの道。決めたこと）

| 道 | いつ | アクション |
|---|---|---|
| **最初の回の確かめ**（A3。`AutoReviewItem.kind === "first_review"`） | 回し方の最初の回。投稿は下書きのまま | `reviewAutoRun(runId, send, fingerprints)`。送るなら、画面に出した配信先の `{ targetId: fingerprint }` をすべて渡す（確かめて送る SNS もまとめて承認し、投稿を予約にする。次の回から確かめない）。送らないなら、その回は取り消し、投稿は下書きのまま（次の回もまた確かめる） |
| **確かめて送る SNS の承認**（X など。`kind === "approval"`） | 2 回目からの回で、確かめて送る SNS があるとき。ほかの SNS は予約のまま送られる | SNS ごとに `approveAutoTarget(targetId, fingerprint)`（承認）か `declineAutoTarget(targetId)`（この SNS には送らない。配信先を外す） |

- 最初の回の確かめを別のアクションにした理由: 投稿全体（予約にするか）と回し方（次から確かめない）を変えるので、配信先ごとの承認とは意味が違う。1 つにすると「X だけ承認したら投稿が予約になる」などの取り違えが起きる
- fingerprint は queries・`loadAutoTargetPreviews` が返す `AutoTargetPreview.fingerprint` をそのまま渡す。**見せた文と、いまの文が違えば断る**（「確かめたあとに文が変わりました。もう一度確かめてください。」）。承認のあとに文を直すと、承認は外れて確かめ待ちに戻る（DB のトリガー）
- 送る時刻を過ぎたら承認できない（「送る時刻を過ぎたので…」）
- 確かめる画面は、`AutoTargetPreview.body`（送る文そのもの。タグを付けた形）と `title` を、SNS ごとにそのまま見せる（X の開発者ポリシー「Show exactly what will be published」）

## 偽の AI（ai.ts）

- 環境変数 `AUTO_POST_FAKE_AI` を `.env.local` に入れると、見本（makeAutoSample）と、engine ができたあとの回の作成が偽の AI で動く。Vercel の上では値があっても使わない
  - `1`（か `ok`）: 材料の名前を入れた決まった文。チェックに通る
  - `held`: 「事実か確かめて」の指摘が付く（下書きに回る道）
  - `cannot`: 「材料だけでは書けません」（飛ばす道）
- テストは `setAutoPostGeneratorForTest(fn)` で差し込み、終わりに `null` で外す

## 状態（posts と post_targets）

- 自動の回で作った投稿は `posts.auto_run_id` が入る（利用者は書けない）。カレンダー・一覧の「↻」はこれで出す
- 確かめて送る SNS の配信先は `post_targets.status = "awaiting_approval"`（画面の言葉は「確かめ待ち」。src/lib/posts/send-mode.ts の TARGET_STATE）。送信ジョブは pending しか取り出さないので、承認の前は送られない。カレンダーの数（counted_post_targets）は、承認するまで予約に数えない
- 送る時刻を過ぎても確かめなかった配信先は、ジョブが `failed` にして `error_message` に理由（labels.ts の EXPIRED_TARGET_LABEL の長い文）を入れる。「送り直す」と、承認の記録がなければ確かめ待ちに戻る
- カレンダーのチップの言葉は labels.ts の `CALENDAR_CHIP`
- スマホの通知は `notification_prefs.auto_post_push`（既定オン）。切り替えの画面はまだない（お知らせの設定に足す）
