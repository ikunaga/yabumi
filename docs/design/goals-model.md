# 目標（KGI）・KPI・ロードマップの作り直し（設計。feat/goals-model）

2026-11-06 に書いた。オーナーが「おすすめ通り」で了承した方針（PM の依頼）を、データ・画面・AI・出し方に落とした設計。**PM が見てから実装に進む。**
決めてほしいことは、最後の「決めてほしいこと」にまとめた。

## 0. いまの作りと困っていること

- KGI は roadmaps（プロジェクトに 1 行）の kgi（jsonb）で、プロジェクトに 1 つだけ。終わった目標は残らない（上書き）
  - 指示が「始めたばかりなら小さく（例: 1 か月で 12 本投稿する）」（consult-prompt.ts）なので、KGI が行動の目標（投稿の本数）になり、事業のゴールになっていない
- KPI の週の目標は roadmaps.kpi_targets（jsonb）。投稿の週の回数は、アカウント設計の first_month.weekly と**両方向に写し合っている**（plan/save.ts の syncRoadmapFromWeekly と syncWeeklyFromRoadmap）。二重の持ち方で、どちらが正かがわかりにくい
- 伴走の 4 週の区切り（first_month.startedOn）は、アカウント設計の JSON の中にある
- roadmap_items は project_id だけでつながっていて、どの目標のためのやることかを持たない（オーナーの指摘「roadmap_items と roadmaps は直接のリレーションを持つべき」）
- 数字の種類の食い違い: zod の KPI_KEYS には outcomes（手で入れる成果）があるが、roadmap_items.kpi の check にはない（入れると落ちる）

## 1. 考え方（オーナーの決定）

| もの | 役目 | 例 |
|---|---|---|
| KGI（goals） | アカウント設計の「見た人にしてほしいこと」（goal.goalType）に合わせた**成果の数字**。期間は 3 か月が基本 | 「2 月末までに SNS から 300 ダウンロード」「3 か月で予約 30 件」 |
| 月ごとの中間の目標（goal_milestones） | KGI を月に分けたもの。AI が案を出す | 1 か月目 60・2 か月目 100・3 か月目 140 |
| KPI（goal_kpis の kpi） | KGI に効く途中の数字 1〜3 個。週の目標を持つ | 行き先へのクリック 週 15 |
| 行動の目標（goal_kpis の action） | 投稿の週の本数（SNS ごと）。伴走が追いかける。いまの first_month.weekly | X 週 3・Instagram 週 2 |
| 週ごとのやること（roadmap_items） | いまのまま。目標につながる | 「柱『季節の器』で 1 本書く」 |

- 始めたばかりの人は、「まず続けること」を KGI にしない。続けることは行動の目標に置き、KGI は小さめの成果にする（例: 3 か月で予約 5 件）
- 成果の数字が取れない人（ストア・RevenueCat をつないでいない、手で入れる成果を使っていない）には、AI が**仮の KGI**としてクリック（link_clicks）を置き、成果を取れるようにする案内を添える（goals.provisional）
- 「月」は **4 週**にする（決めてほしいこと Q1）。KGI の基本の期間は 12 週（約 3 か月）。伴走の 4 週の区切りと中間の目標の区切りが同じになり、毎月の振り返りが 1 つで済む。KGI の期限と 3 つ目の区切りも同じ日になる

## 2. データの作り

### 2.1 テーブル

**goals（KGI。プロジェクトに複数、active は 1 つだけ）**

| 列 | 型 | 制約・意味 |
|---|---|---|
| id | uuid | pk |
| project_id | uuid | not null、projects を on delete cascade |
| owner_id | uuid | not null、auth.users を on delete cascade |
| statement | text | 1〜120 字。null は「KGI をまだ決めていない」 |
| metric | text | 数字の種類。下の「数字の種類」の表の中から。null は KGI まだ |
| action | text | metric が outcomes のときだけ（purchase・signup・booking・inquiry・visit。project_outcomes_daily と同じ） |
| sns | sns_key | metric が followers・views のときだけ（null はすべての SNS） |
| target | numeric | > 0、≤ 10,000,000 |
| starts_on | date | 数え始め（月曜） |
| ends_on | date | 期限（starts_on より後、starts_on + 371 日まで）。KGI まだなら null |
| status | text | active・achieved・expired・replaced。既定 active |
| result_value | numeric | 終わったときの結果（サーバーが数える） |
| closed_at | timestamptz | 終わった日時（サーバーが決める） |
| provisional | boolean | 仮の KGI（成果の代わりにクリック）。既定 false |
| source | text | ai・manual |
| created_at・updated_at | timestamptz | |

- check: statement・metric・target・ends_on は全部あるか全部 null（KGI まだ）。`(metric = 'outcomes') = (action is not null)`。sns は followers・views のときだけ。`(status = 'active') = (closed_at is null)`。result_value は active のとき null
- 部分ユニークのインデックス: `unique (project_id) where status = 'active'`
- KGI まだの active な goal を許すのは、KGI を決める前から週の回数（伴走）とやることを持つ人がいるため（いまも roadmaps.kgi は null を許している）

**goal_milestones（月ごとの中間の目標 ＝ 伴走の 4 週の区切り）**

| 列 | 型 | 制約・意味 |
|---|---|---|
| id | uuid | pk |
| goal_id | uuid | not null、goals を on delete cascade |
| owner_id | uuid | not null（RLS 用。goal と同じ人であることをトリガーで確かめる） |
| seq | integer | 1〜13。goal の中の何番目か。unique (goal_id, seq) |
| starts_on | date | 月曜 |
| ends_on | date | starts_on + 27 |
| target | numeric | その月の目標の値（KGI まだなら null）。累計ではなく、その 4 週の分 |
| result_value | numeric | その 4 週の結果。区切りを過ぎてから、サーバーが数えて入れる |
| settled_at | timestamptz | 結果を入れた日時 |

- いまの first_month.startedOn（伴走の区切り）は、ここに移す。「次の 1 か月を始める」は、新しい区切りの行を足すこと
- 期間が重なる行は作らない（goal の中で seq の順に続く。関数の中で確かめる）

**goal_kpis（KPI と行動の目標）**

| 列 | 型 | 制約・意味 |
|---|---|---|
| id | uuid | pk |
| goal_id | uuid | not null、goals を on delete cascade |
| owner_id | uuid | not null（RLS 用） |
| role | text | kpi（KGI に効く途中の数字）・action（投稿の週の本数） |
| metric | text | role = action なら posts だけ。kpi なら posts 以外 |
| action | text | metric = outcomes のときだけ |
| sns | sns_key | action では必須（SNS ごとの本数）。kpi では followers・views のときだけ |
| per_week | numeric | > 0。action は 1〜14 の整数（いまの MAX_WEEKLY_PER_SNS） |
| position | integer | 並び |

- unique (goal_id, role, metric, coalesce(action,''), coalesce(sns,'')) の代わりに、式のユニークインデックス
- role = kpi は 3 つまで、action は SNS の数まで（関数の中で確かめる）

**roadmap_items（足すもの）**

- goal_id uuid → goals、**on delete cascade**（PM の指定）
- 同じプロジェクト・同じ人の goal であることを、トリガー（security definer。posts_check_roadmap_item と同じ形）で確かめる。新しく足すときは、active な goal だけ
- kpi の check に outcomes を足す（いまの食い違いを直す）。outcomes のときは action 列も要るので、roadmap_items にも action を足す（metric と同じ check）
- 段階 ① では null を許し、段階 ④ で not null にする（4. の出し方）

### 2.2 数字の種類

| metric | 数え方 | 自動か | KGI に使えるか |
|---|---|---|---|
| posts | counted_post_targets（送った投稿） | 自動 | **使わない**（行動の目標）。前の KGI を移したものだけ残る |
| link_clicks | 短縮リンクのクリック（link_click_daily） | 自動 | 使える（仮の KGI もこれ） |
| downloads・store_page_views・revenue | ストアと RevenueCat の取り込み（store_daily） | つなげば自動（2〜3 日遅れる） | アプリのときだけ |
| outcomes（action ごと） | 手で入れる成果（project_outcomes_daily） | 手入力 | 使える（予約・購入・問い合わせ・来店・登録） |
| followers | SNS の数字（いちばん近い日の数の差。増えた人数） | つなげば自動 | 使える（goalType が follow のとき） |
| views | SNS の数字（送った投稿の閲覧の合計） | つなげば自動 | 使える（goalType が awareness のとき） |

goalType（見た人にしてほしいこと）と KGI の数字の対応（AI の案の既定。product-guide.ts の考え方と同じ）:
download → downloads、purchase・signup・booking・inquiry・visit → outcomes（同じ action）、follow → followers、awareness → views、other → link_clicks。
数字を取れない（つないでいない・手で入れていない）ときは、AI が link_clicks の仮の KGI にし、「ストアをつなぐ」「成果を手で入れる」の案内を添える。

### 2.3 数える関数（サーバーが数える。クライアントに結果を書かせない）

- `goal_metric_total(p_project_id, p_metric, p_action, p_sns, p_from, p_to)` → `(value numeric, counted_through date, available boolean)`
  - security invoker（RLS で本人のプロジェクトだけ）。数字の種類ごとに上の表の表を足す
  - counted_through: 数えた最後の日（ストアは届いている日まで。今日より後は数えない）。画面は「11/4 まで」と添える（正しくない数字を見せない）
  - available = false: その数字の取り込み元がない（つないでいない）。画面は数字の代わりに「数えていません」と案内
- KGI・中間の目標・KPI の週の値は、すべてこの関数から出す（いまの kgiProgress・itemProgress の posts・link_clicks の分はそのまま使える）

### 2.4 書き込み（すべて security definer の関数。テーブルには select だけ）

状態・結果の値・閉じた日時・区切りの日付はサーバーが決めるので、authenticated にはテーブルの insert・update・delete を与えない。関数は auth.uid() を本人とし、`revoke all ... from public, anon, authenticated, service_role` のあと、authenticated（と、伴走のジョブ用に要るものは service_role）にだけ grant execute。

| 関数 | すること |
|---|---|
| `start_goal(p_project_id, p_goal jsonb, p_milestones jsonb, p_kpis jsonb, p_source)` | 新しい KGI を始める（AI の採用・手で決める）。プロジェクトごとの advisory lock の中で、いまの active を閉じ（下の「閉じ方」）、新しい goal・中間の目標・KPI と行動の目標を 1 つのトランザクションで作る。行動の目標を渡さなければ、前の goal のものを引き継ぐ |
| `revise_goal(p_goal_id, p_statement, p_target, p_ends_on, p_milestones jsonb)` | active な KGI を見直す（文・目標の値・期限と、まだ始まっていない中間の目標） |
| `set_goal_kpis(p_goal_id, p_kpis jsonb, p_role)` | KPI か行動の目標を入れ替える（アカウント設計の週の回数・AI の採用） |
| `start_milestone(p_goal_id, p_target, p_restart boolean)` | 毎月の振り返りで、終わった区切りの結果を数えて入れ、次の区切り（4 週）の目標の値を決める。「次の 1 か月を始める」もこれ |
| `settle_goal(p_goal_id)` | 区切りの振り返りを AI なしで終えるとき（「この目標を終える」）。結果を数えて閉じる |

- 閉じ方（サーバーが決める）: goal_metric_total で結果を数えて result_value に入れ、結果 ≥ 目標なら achieved、期限を過ぎていれば expired、どちらでもなければ（期限前に別の KGI に替えた）replaced
- 中身の確かめ（字数・数字の種類・範囲・KPI 3 つまで）は、関数の中と表の check の両方で行う（アプリの zod は画面のための写し）

### 2.5 RLS と grant

- 3 つのテーブルとも RLS を有効にし、select だけ `owner_id = auth.uid()`。authenticated に grant select だけ。service_role に all
- roadmap_items は今のまま（本人が直接書く）。goal_id は列の grant に入れるが、トリガーで同じプロジェクト・同じ人・（足すときは）active な goal に限る
- 結合テスト: 他人の goal が読めない、テーブルに直接書けない、関数で他人のプロジェクトに作れない、状態・結果を書けない、同時に start_goal しても active は 1 つ

## 3. 今のデータの移し方（段階 ① のマイグレーション）

1 つのマイグレーション（1 トランザクション）で、roadmaps には触らずに写す。

1. テーブル・関数・トリガーを作る
2. roadmaps の行ごとに goals を 1 行作る（starts_on = started_on、statement・metric・target・ends_on は kgi から、sns も。kgi が null や形の違うものは KGI まだの goal。status は active。source はそのまま）
   - 前の KGI が posts（行動の目標）でも、そのまま写す。画面で「成果の目標に変えましょう」と知らせる（5.）
3. kpi_targets を goal_kpis に写す（posts は role = action、それ以外は kpi）
4. アカウント設計の first_month.weekly を正として、role = action を作り直す（いまは両方向に写し合っているので同じはずだが、違えば伴走が読んでいる weekly を正とする）
5. roadmaps がなく first_month.weekly だけあるプロジェクト（伴走だけ使っている人）にも、KGI まだの goal を作る
6. first_month.startedOn があれば、goal_milestones の seq 1 にする（starts_on = startedOn、target は null）
7. roadmap_items.goal_id を、そのプロジェクトの goal で埋める（roadmaps がなくやることだけあるプロジェクトは、5. と同じく KGI まだの goal を作ってから）
8. 確かめ: 移したあとの件数（roadmaps の行数 = 写した goals、やることの goal_id が null の行が 0）をマイグレーションの中で数え、合わなければ raise（全体が戻る）

- オーナーの ddy のデータ: 上の 2〜7 でそのまま残る。本番に当てる前に、ローカルで同じ形の行（KGI あり・なし、やることだけ、伴走だけ）を作る結合テストで移し方を確かめる
- 戻し方: ① は roadmaps と first_month を変えないので、戻すときは足したものを消す SQL（drop の順番を docs に書く）だけで前に戻る

## 4. 本番に出す順番

`supabase db push` からコードの出し直しまでの数分間に、前のコードが動き続けるように段階に分ける。

| 段 | 出すもの | 前のコードは動くか |
|---|---|---|
| ① | マイグレーション（足して写すだけ）＋ **橋渡しのトリガー**（roadmaps に書くと active な goal に写す。roadmap_items に goal_id なしで足すと、active な goal を入れる）＋ src/lib/goals の読み書き（まだ画面は使わない） | 動く。前のコードは roadmaps と first_month.weekly に書き、トリガーが goals に写す |
| ② | 画面と伴走を goals に切り替える（ロードマップ・概要・分析・カレンダー・アカウント設計・伴走のジョブとメール） | db push は ① で済んでいるので、コードを出すだけ。出し直しの数分間は、前のコードの書き込みも橋渡しで goals に入る |
| ③ | AI（consult と plan-coach）と区切り（目標の振り返り、毎月の振り返りを中間の目標に） | 新しい topic を足すだけ。前の画面から来る start=month_review も動く |
| ④ | 本番で移し終えたのを確かめてから（PM）: 橋渡しのトリガーを消し、roadmap_items.goal_id を not null にし、roadmaps を消す（別のマイグレーション）。消す前に roadmaps を CSV で控える（Supabase Free にはバックアップがない） | ② のあとは誰も roadmaps を読まない |

- ② から ④ の間に前のコードへ戻すと、② のあとの変更が roadmaps にない。戻すときは goals から roadmaps と first_month.weekly に書き戻す SQL を使う（② の PR に入れておく。PM の了承のうえで流す）
- アカウント設計の JSON の first_month.weekly・startedOn・goal・metrics は、④ のあとも JSON に残るが読まない（schema からは ④ で外す）

## 5. 画面の変わるところ（段階 ②）

| 画面 | 変わるところ |
|---|---|
| ロードマップ | 上に「いまの目標」: KGI の文と進み具合（実際 / 目標、残りの日、このままの見込み、数えた最後の日）、中間の目標（4 週ごとの目標と結果、いまの区切り）、KPI と週の目標、行動の目標（SNS ごとの週の本数）。下にやることを週ごとに（いまのまま）。いちばん下に**「これまでの目標」**（閉じた goal を新しい順に: 文・期間・結果 / 目標・達成／期限切れ／見直し、開くとその目標のやること）。KGI まだなら「AI と目標を決める」。前の KGI が posts なら「成果の目標に変えましょう」の 1 行 |
| 概要の帯（いまやること） | 帯の種類に goal_review を足す。active な KGI の期限が来た、または目標に届いた → 「目標『…』の期限が来ました（届きました）」と「AI と振り返る」（AI が使えなければ「ロードマップで終える」）。いまの cycle_ended（4 週の区切り）は、中間の目標の区切りとして残す。両方が 7 日以内に重なれば goal_review の 1 つにまとめる |
| アカウント設計の「最初の 1 か月」 | 名前を「週の回数」にし、SNS ごとの週の本数（goal_kpis の action）を書く。1 か月後の目標の文と「何を見て判断するか」は、KGI（ロードマップ）へのリンクに替える。KPI のチェックは KPI（goal_kpis の kpi）に移す |
| 分析 | 上の「目標: …」を KGI の文と進み具合に替え、いまの中間の目標を添える。KPI のカードは goal_kpis の kpi（なければ今の chosenKpis） |
| カレンダーの帯 | 週の目標を goal_kpis の action から読む（過ぎた週は今のまま pace_weeks）。月の見出しの横に、その月の中間の目標を小さく |
| AI と相談 | ロードマップの段の「最終の目標」で、中間の目標も一緒に決める。新しい入口「目標を振り返る」（6.）。案のカードに中間の目標の表 |
| 伴走（ジョブ・メール・プッシュ） | 週の回数を goal_kpis の action、区切りを goal_milestones から読む。メールの文はそのまま（「最初の 1 か月」の言い方だけ「この 1 か月」に） |

## 6. AI の指示の変わるところ（段階 ③）

**consult（相談）**
- 「始めたばかりなら小さく（例: 1 か月で 12 本投稿する）」を消す。KGI は「見た人にしてほしいこと」に合わせた成果の数字で、期限は基本 12 週（約 3 か月）。posts は KGI にしない（案の schema でも断る）
- 始めたばかりの人: 続けることは行動の目標（週の本数）に置き、KGI は小さめの成果にする
- 数字を取れない人: link_clicks の仮の KGI にし、「ストアをつなぐ」「成果を手で入れる」を案内する（provisional）
- KGI の案に、中間の目標（4 週ごと 3 つ。後ろほど多めにする理由を添える）を入れる。案の形は `{"kgi":{statement, metric, action, sns, target, weeks, provisional}, "milestones":[{target}...]}`
- KPI は 1〜3 個（KGI に効く途中の数字。posts は含めない）。行動の目標は別の案（`action_targets`、SNS ごとの週の本数）
- 新しい入口 goal_review（目標を振り返る）: 結果を ① 届いたか ② よかった点 ③ 次に変えること でまとめ、次の KGI の案を 2〜3 個出す。採用すると start_goal（前の目標は結果とともに閉じる）。ゴールは次の KGI の採用
- month_review（毎月の振り返り）を中間の目標に合わせる: その 4 週の結果と目標を比べ、来月の中間の目標と週の本数を決める。KGI の見込み（このままのペース）が届かないときは「打ち手を変える案」か「KGI を見直す案」（revise_goal）を出す
- 伴走の区切りと KGI の期限が 7 日以内に重なるときは、goal_review の中で次の 1 か月もまとめて決める
- いまの状況に: KGI の進み具合（数えた最後の日・数えていない数字）、中間の目標、KPI、これまでの目標（直近 3 つの結果）

**plan-coach（アカウント設計の相棒）**
- first_month の案は週の本数だけにする（goal の文に「4 週間で X に 8 回」を書く決まりを消す）。KGI はロードマップ（相談）で決めると案内する
- 見た人にしてほしいこと（goalType）を決める段で、「これが 3 か月の目標（KGI）の数字になります」と添える

## 7. 自動で数える数字と、手で入れる数字

- 自動（yabumi のデータ）: posts・link_clicks。いまの roadmap_daily_totals・roadmap_item_progress をそのまま使う
- つなげば自動: downloads・store_page_views・revenue（ストア・RevenueCat。2〜3 日遅れる）、followers・views（SNS の数字）。数えた最後の日を必ず添え、届いていない日は 0 として数えない
- 手で入れる: outcomes（予約・購入・問い合わせ・来店・登録）。分析の画面の「成果を入れる」（project_outcomes_daily）。KGI が outcomes なら、ロードマップと概要の帯から「今週の成果を入れる」に移れるようにする。入れていない週は「まだ入れていません」と出し、0 と見せない
- 数えられない（つないでいない）KGI は、進み具合の代わりに「数えていません。〇〇をつなぐと数えられます」（正しくない数字を見せない）

## 8. 段階の分け方と担当の案

| 段 | 中身 | 担当の案 | 前の段への依存 |
|---|---|---|---|
| ① データ | マイグレーション（表・関数・橋渡し・移し替え）、src/lib/goals（読み込み・書き込み・数える）、結合テスト、docs の 4.23 の書き直し | 実装担当1（私） | なし |
| ② 画面 | ロードマップ（これまでの目標を含む）・概要の帯・アカウント設計の週の回数・分析・カレンダー・伴走のジョブとメール、書き戻しの SQL | 実装担当2 | ① が main に入ってから（src/lib/goals の型と関数を使う） |
| ③ AI と区切り | consult の指示・案の schema・goal_review の入口・month_review の作り直し・plan-coach の指示 | 実装担当3 | ① が main に入ってから。概要の帯の goal_review は ② と ③ のどちらかに寄せる（② に寄せる案） |
| ④ 片付け | 橋渡しを消す、goal_id を not null、roadmaps を消す | 実装担当1 | 本番で ①〜③ を確かめてから |

- ② と ③ は並べて進められる。ぶつかりそうなのは consult.ts の「いまの状況」と、概要の帯の種類（nowBandKind）。帯は ② が作り、③ は入口（start=goal_review）を作る、と分ける
- 法務: 新しく預かる情報はない（目標と数字は今もある。結果の値が残るだけ）ので ① の書き足しの見込み。「これまでの目標」を残す期間はプロジェクトと同じ（消すまで）

## 9. 決めてほしいこと

- **Q1**: 「月」を 4 週にしてよいか（KGI の基本は 12 週、伴走の区切り ＝ 中間の目標の区切り）。暦の月にすると、伴走の 4 週と区切りがずれ、毎月の振り返りが 2 つになる
- **Q2**: 前の KGI（投稿の本数）を、移すときに goal のまま残して「成果の目標に変えましょう」と知らせる形でよいか（自動で別の数字に変えない）
- **Q3**: 期限前に KGI を見直したとき、前の目標は replaced として「これまでの目標」に残す（消さない）でよいか
- **Q4**: 目標に届いたとき、期限まで続けるか、すぐ次の KGI に移るかは、goal_review で AI が 2 つの案として出す形でよいか
