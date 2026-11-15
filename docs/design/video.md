# 投稿に動画を添える

オーナーが TikTok と YouTube に動画を送ると決めた（2026-11-14〜15）。このメモは、動画を投稿に添える共通の仕組みを決める。

- TikTok は写真から作り（実装担当3 の feat/tiktok、docs/design/tiktok.md）、審査を待つ間に動画を足す。
- YouTube は動画だけを送る（実装担当2 の docs/design/youtube.md）。
- 出発点は docs/architecture.md の 4.24（2026-10-11 の調べと設計）。このメモはそれを 2026-11-15 に調べ直し、作れる形に詰めたもの。

本物の API は呼んでいない。公式の資料（2026-11-15 に読んだ）で確かめられなかったことは【未確認】、4.24 から変わったことは【変わった】と書く。

コードは PM の了承まで書かない。

---

## 0. オーナーに決めてほしいこと

| # | 決めること | 選択肢 | おすすめ | 理由 |
|---|---|---|---|---|
| W1 | いまの SNS（X・Threads・Instagram・Facebook）にも動画を送るか | ア. 4 つとも／イ. Threads・Instagram（リール）・Facebook（リール）の 3 つ。X は 1080×1920 が通るか確かめてから／ウ. 送らない（TikTok・YouTube だけ） | **イ** | Meta の 3 つは、画像と同じく SNS に取りに来てもらう作りが使え、足す手間が小さい。リールは届く人が多い。X は大きさの上限に食い違いがあり（W2）、先に 1 本送って確かめたい |
| W2 | X の大きさ（1080×1920 が通るか【未確認】） | ア. 作り始めに、オーナーの X で 1 本だけ送って確かめる（約 $0.015）。通らなければ、X 向けだけ 720×1280 をもう 1 本作る／イ. 初めから全部の SNS を 720×1280 にする／ウ. X には動画を送らない | **ア** | イは、リールやショートの画質が落ちる。X の資料は「1280×1024 まで」「推奨は縦 720×1280」「有料の人は 1080p」と書いてあり、文字どおりでは縦 1920 は通らない |
| W3 | 動画の長さの上限 | ア. 一律 3〜90 秒／イ. 送り先で変える（Facebook を選ばなければ 3 分まで） | **ア**（4.24 の V5 と同じ） | Supabase Free は 1 ファイル 50MB まで。90 秒で 1080×1920 の画質を保てるのがここまで。Pro にしたら イ に広げる |
| W4 | Supabase Free のうちの上限 | 下の 8. の案（利用者ごとの量・月の本数・全体の量） | 8. の案 | Free の転送量は月 5GB。動画 1 本で約 0.2〜0.4GB 使う（8.） |
| W5 | 音声を作り直せない動画をどうするか | ア. 「この動画の音声は扱えません」と出して受け付けない／イ. 音声を作る追加の部品（`@mediabunny/aac-encoder`）を入れる | **ア**（まず） | iPhone と Android のカメラの動画は音声が AAC なので、作り直さずにそのまま使える（2.）。困るのは画面録画などの一部だけ。イの部品は、大きさ・ライセンスを確かめられていない【未確認】 |
| W6 | 送り終えた動画をいつ消すか | ア. 送り終えて 1 日（送れなかったものが残っていれば 7 日）／イ. 画像と同じ 30 日 | **ア**（4.24 と同じ） | 動画は画像の 100 倍ほど大きく、Free の容量（1GB）を早く埋める。消したあとは、投稿の画面に「動画は送り終えたので消しました」と出す |

4.24 の V1〜V5 のいまの扱い:
- V1（いつ作るか）: 2026-11-14 にオーナーが「作る」と決めた。
- V2（費用）: まだ決まっていない。roadmap の段階 ②（招待制）で Supabase を Pro にする予定と合わせる（8.）。
- V3（TikTok の送り方）: docs/design/tiktok.md で、直接投稿を基本に、下書きを逃げ道にすると決めた。
- V4（YouTube の Google Cloud のプロジェクト）: docs/design/youtube.md で扱う。
- V5（長さの上限）: 上の W3。

---

## 1. 4.24 から変わったこと（2026-11-15 に調べ直した）

| 項目 | 4.24（2026-10-11） | いま | 設計への影響 |
|---|---|---|---|
| **Safari の AAC の作り直し** | 使えるか【未確認】 | 【変わった】<ul><li>Safari 26.0 から、音声を作る仕組み（AudioEncoder）そのものが入った。25 以前は音声を作れない</li><li>Safari 26〜27.x では、AAC を作って MP4 に入れると**音のない動画になる不具合**がある（WebKit Bug 302253）。2026-10-22 に直され、Safari Technology Preview 256 に入った。直った正式版の番号は【未確認】</li><li>Firefox はどの環境でも AAC を作れない。Linux はどのブラウザでも作れない（MDN、2026-08-12）</li></ul> | **音声は作り直さず、元の AAC をそのまま使う**のを基本にする（2.）。作り直しが要る音声は、当面は受け付けない（W5） |
| **X の 1080×1920** | 通るかは 1 本送って確かめる | 【変わらず未確認】<ul><li>資料は「32×32〜1280×1024」</li><li>推奨は縦 720×1280</li><li>「サブスクの利用者は 1080p を上げられる」とある</li></ul> | W2 のとおり、作り始めに 1 本送って確かめる |
| X の長さ・大きさ | 20 分・8GB | 同じ。140 秒・512MB は DM だけ | なし |
| X の分割の大きさ | 5MB ずつ | 5MB 以下を推奨（上限 8MB） | なし |
| X の費用 | 投稿 $0.015 | 投稿 $0.015、**URL を含む投稿は $0.20**。画像・動画を上げる料金の行はない【未確認】 | 動画とは別に、URL の費用は X の費用の見積もりに既にある |
| mediabunny | 候補 | v1.66.0（2026-11-13）、MPL-2.0（使うだけなら、yabumi のコードを公開する必要はない）<br>最小 5kB（gzip）から、使う部分だけ読み込める<br>次の 4 つがそろっている<ul><li>読み取り（長さ・コーデック・回転・表示の大きさ）</li><li>作り直さないコピー</li><li>切り取り・縮小・回転</li><li>進み具合（onProgress）</li></ul> | 使う。edit list（Threads・Instagram が嫌う）を書き出すかは【未確認】。サーバーの確かめ（3.）で弾き、作り始めに確かめる |
| ffmpeg.wasm | 30MB ほどで重い | 公式の測定で、本来の 12〜25 倍遅い。複数スレッドには COOP/COEP（ページ全体の設定）が要る | 使わない |
| ブラウザの映像の作り直し | 主なブラウザで使える | VideoEncoder は Safari・iOS 16.4〜、Chrome・Edge 94〜、Firefox（PC）130〜。Android の Firefox は使えない。H.264 を作れるかはブラウザの表がないので、その場で `VideoEncoder.isConfigSupported` で確かめる | 2. の「使えないブラウザ」 |
| Supabase の 1 ファイルの上限 | Free 50MB | Free 50MB、**Pro は 500GB**（全体の上限の設定で、バケットごとはそれ以下） | Pro にしたら 50MB を上げられる |
| TUS | 6MB ずつ、署名つきのトークン | 6MB は変えない。送り先は `https://<project>.storage.supabase.co/storage/v1/upload/resumable`（直接のホスト名）。署名つきの URL は 2 時間、TUS の URL は 24 時間。`createSignedUploadUrl` の token を `x-signature` に入れて使う | 同じ。署名つきで上げるときに RLS のポリシーが要るかは、いまの資料に書かれていない【未確認】。画像（PUT）はポリシーなしで動いているので、TUS でも同じかをローカルで確かめる |
| Supabase の料金 | Free 1GB・5GB、Pro $25 | 同じ。Pro は 100GB・250GB、超えた分は保存 $0.0213/GB、転送 $0.09/GB（キャッシュなし） | 8. |
| Range（途中から読む） | 対応しているとみられる【未確認】 | 公式の資料に記述がない【未確認】 | 送るときに途中から読む（YouTube）。効かなければ全体を読む（5.） |
| Instagram リール | 3 秒〜15 分、300MB | 同じ。ほかに次の 2 つが加わった<ul><li>器（コンテナ）は 24 時間で切れる</li><li>投稿の上限は「24 時間で 100」と「50」がページの中で食い違う【未確認】</li></ul> | 上限は少ない 50 で数える |
| Threads | 5 分、1GB、video_url だけ | 同じ。ほかに次の 2 つがわかった<ul><li>カルーセルにも動画を入れられる</li><li>24 時間で 250 投稿まで</li></ul> | 動画は 1 本だけなので、カルーセルは使わない |
| Facebook リール | 3〜90 秒、9:16、540×960 以上 | 同じ。推奨 1080×1920、音声は AAC-LC ステレオ 48kHz・128kbps 以上、**24 時間で 30 本** | 90 秒の上限はここから |
| TikTok | 10 分、FILE_UPLOAD | 同じ。分割は 5〜64MB（最後は 128MB まで）、5MB 未満は 1 回で送る。音声の決まりは書かれていない【未確認】 | 50MB までなので、1 回で送れる |
| YouTube | videos.insert は専用の枠で 1 日 100 回 | 同じ。ほかに 2026-11-02 から、**確認を受けていないプロジェクトから上げた動画も、非公開に固定されなくなった**（改訂履歴）【変わった】 | youtube.md |
| Opus の音声 | ― | X・Threads・Instagram・Facebook はどれも AAC と決めている | Opus に逃げられない（W5） |

出典:
- https://github.com/Vanilagy/mediabunny/releases
- https://mediabunny.dev/guide/converting-media-files
- https://mediabunny.dev/guide/supported-formats-and-codecs
- https://caniuse.com/mdn-api_audioencoder
- https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- https://bugs.webkit.org/show_bug.cgi?id=302253
- https://webkit.org/blog/18602/release-notes-for-safari-technology-preview-256/
- https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection
- https://ffmpegwasm.netlify.app/docs/performance
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/pricing
- https://docs.x.com/x-api/media/quickstart/best-practices
- https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- https://docs.x.com/x-api/getting-started/pricing
- https://developers.facebook.com/docs/threads/overview
- https://developers.facebook.com/docs/instagram-platform/content-publishing
- https://developers.facebook.com/docs/video-api/guides/reels-publishing
- https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
- https://developers.google.com/youtube/v3/revision_history

---

## 2. ブラウザで形をそろえる

### yabumi の 1 本の形（すべての SNS に同じ 1 本）

| 項目 | 値 | どの SNS の決まりから |
|---|---|---|
| 容器 | MP4。moov を先頭に置く。edit list は書かない | Threads・Instagram |
| 映像 | H.264（High）、30fps 固定、closed GOP、2 秒ごとにキーフレーム、4:2:0、プログレッシブ | X（H.264・open GOP 不可）、Facebook（fps 固定・closed GOP） |
| 大きさ | 縦 9:16 の 1080×1920 に収める。元が横長・正方形なら、縮めて上下に黒の帯を入れる。元が 1080×1920 より小さいときは拡大しない（540×960 未満は受け付けない） | Facebook リール（9:16・540×960 以上）、ショート |
| 音声 | AAC-LC。元が AAC-LC ならそのまま使う（作り直さない）。音声なしの動画は、音声なしのまま | X・Threads・Instagram・Facebook |
| 長さ | 3〜90 秒 | Instagram・Facebook の下限、Facebook リールの上限（W3） |
| 大きさの上限 | 50MB | Supabase Free の 1 ファイルの上限 |
| 映像の速さ（ビットレート） | `min(6Mbps, (48MB × 8 ÷ 秒数) − 音声のビットレート)`。90 秒で約 4.1Mbps | 50MB に収める。X の推奨「5Mbps 以上」は、60 秒を超えると下回る（推奨で、決まりではない） |

- 音声なしの動画を Facebook リールと Instagram が受け付けるかは【未確認】。作り始めに 1 本ずつ確かめる。断られたら、無音の AAC を足す（W5 のイの部品が要る）。

### 流れ

```
「動画を選ぶ」（input type=file、accept="video/*"。iPhone では写真ライブラリとカメラが出る）
  ↓
① 読み取る（mediabunny の Input。中身を作り直さず、箱を読むだけ。1 秒以内）
   長さ・映像のコーデックと大きさ・回転・音声のコーデック・fps の見込み
   → 読めない・映像がない → 「この動画は読み取れませんでした」
   → 3 秒未満 → 「3 秒以上の動画を選んでください」
   → 540×960 に足りない → 「動画が小さすぎます」
   → 音声が AAC-LC でも、なしでもない → W5（「この動画の音声は扱えません」）
  ↓
② このブラウザで作り直せるかを確かめる
   VideoEncoder.isConfigSupported（avc1、1080×1920、30fps）
   VideoDecoder.isConfigSupported（元の映像。iPhone の HEVC など）
   → だめ → 「使えないブラウザ」（下）
  ↓
③ 長さを決める
   90 秒以下 → 全体
   90 秒を超える → 「どこからどこまで使うか」を選ぶ（初期値は最初の 90 秒。下の画面）
  ↓
④ 作り直す（mediabunny の Conversion）
   映像はいつも作り直す: 30fps 固定・2 秒ごとのキーフレーム・9:16 に収める・回転を当てる
   音声は作り直さずにコピーする（切り取りもコピーのまま）
   メタデータ（撮影の場所・日時・機種）は書き出さない（作り直すので元の箱は残らない）
   進み具合: 「動画を整えています 45%」。やめるボタン
  ↓
⑤ 上げる（3.）。進み具合: 「上げています 60%」
  ↓
⑥ プレビュー: 作り直した手元の動画（blob の URL）をそのまま再生する（Storage から読まないので、転送量を使わない）
```

- **映像をいつも作り直す理由**: ほぼすべての SNS の決まりを満たすことを確かにするため。
  - そのまま通せるかを判定するには、元の動画について次の 3 つまで確かめる必要がある。ブラウザでは確かめにくく、判定を誤ると SNS で断られる。
    - closed GOP か
    - fps が固定か
    - edit list があるか
  - iPhone の既定は HEVC なので、どのみち作り直しになる（X が HEVC を受け付けないため）。
  - 作り直しには時間がかかる。iPhone の Safari で 90 秒の 4K60 の動画にどのくらいかかるかは【未確認】。作り始めに測り、画面の「目安」の文に使う。
- **音声をコピーする理由**:
  - Safari の AAC の不具合を避けられる（1.）。
  - Firefox と Linux は AAC を作れない。
  - コピーなら音質も落ちない。
  - iPhone と Android のカメラの動画は AAC-LC（44.1kHz か 48kHz）。Instagram・Threads の「48kHz まで」は満たす。
  - Facebook リールの「48kHz」が 44.1kHz を断るかは【未確認】。作り始めに iPhone の動画で確かめる。
- **作っている間は、この画面を開いたままにする**: 別のアプリに切り替えると、iPhone ではブラウザが止まることがある。
  - 「整え終わるまで、この画面を開いたままにしてください」と 1 行出す。
  - 止まったら「もう一度整える」を出す。
- **やめる**: 作り直し・上げる途中で「やめる」を押せる。上げ途中の引換券は、1 日で片付く（7.）。

### 長さを選ぶ画面（90 秒を超えるとき）

- 動画のプレビューの下に、範囲を選ぶ入力を 2 つ（始まり・終わり）出す（2026-11-15 に作った形。PMO の確かめで、この動きでよいと PM が決めた）。
  - 始まりと終わりは別々に動かせる。片方を動かして 3〜90 秒を外れたら、もう片方が合わせて動く（clampRange）。
  - 90 秒以下の動画でも、整えると 50MB を超えたときは、この欄を「この動画は、整えると大きくなりすぎます。使う範囲を短くしてください」の文で出す（ほかに短くする手段がないため）。
- 「0:12〜1:42（90 秒）を使います」と、数字で出す。
- 読み上げ: 範囲の両端は `input type=range`（始まり・終わり。秒）にする。
- 見た目の案は、作る前に PM に出す（見た目の変更は先に案を出す約束）。

### 使えないブラウザ

- 映像を作り直せないブラウザでは、「動画を選ぶ」のボタンを押せる状態のまま残す。選んだときに次の 1 行を出す。
  - 「このブラウザでは動画を整えられません。スマホの Chrome か Safari（iOS 17 以上【未確認: 最低の版】）、パソコンの Chrome・Edge・Safari で開いてください」
  - 対象: Android の Firefox、古い Safari など。
- 元の映像を読めないとき（Windows の Chrome で、HEVC の再生の部品がない、など）は、次の 1 行を出す。
  - 「この動画の形式は、このパソコンでは読めません。スマホから選ぶか、撮り直した動画を選んでください」
- 判定は選んだときにする（画面を開いただけでは確かめない）。

---

## 3. 上げ方

```
ブラウザ: 形をそろえた MP4（50MB まで）
  → サーバー（requestVideoUpload。server action）
       issue_video_upload_ticket（DB の関数。上限を確かめて引換券を記録する。7. 8.）
       createSignedUploadUrl（post-videos の <利用者の ID>/<乱数>.mp4。2 時間）
       返すもの: 置き場所・token・TUS の送り先
  → ブラウザ: TUS で Storage に直接、6MB ずつ（x-signature に token。x-upsert は false）
       途中で切れても、同じ画面の中なら続きから（tus-js-client の標準の動き）
  → サーバー（confirmVideoUpload。server action）
       引換券が本人のものか
       ファイルを読み、MP4 の箱を確かめる（下）
       合わなければ: ファイルを消し、引換券を消し、理由を返す
       合えば: media_files に kind = 'video' で記録し、引換券を消す
```

- **TUS の部品**: `tus-js-client`（MIT。Supabase の資料が使う例）。ブラウザだけで使い、動画を選んだときに読み込む。版は作るときに 2 週間以上前のものを固定する。
- **サーバーの確かめ**（作り直さない。読むだけ）:
  - ファイル全体を読む（50MB まで）。mediabunny の Input で、トラックと箱を読む（Node でも読むだけなら動く【未確認】。動かなければ、ftyp・moov・trak・stsd・mvhd・tkhd・edts・udta を読む小さな関数を書く）。
  - 確かめること:
    - ftyp が MP4 であること。
    - moov が mdat より前にあること。
    - edts（edit list）がないこと。
    - 映像が 1 本で avc1 であること。
    - 音声は 0 本か、1 本の mp4a.40.2 であること。
    - 長さが 3〜90 秒であること。
    - 表示の縦横が 1080×1920 以下で 540×960 以上であること。
    - 大きさが 50MB 以下であること。
    - fps が 23〜60 であること（見込みで判定する）。
  - **メタデータの箱（udta・meta・位置の情報）があれば受け付けない**。サーバーでは書き直さない。
    - yabumi のブラウザで作ったものには入らないので、入っているのは yabumi を通らずに上げられたものだけ。
    - サーバーで作り直すと、50MB を関数の中で扱うことになり、時間とメモリを使う。
  - 長さ・縦横・大きさは、ブラウザが言う値ではなく、サーバーが読んだ値を記録する。
- **Vercel の関数の時間**: 50MB を読んで箱を確かめるのは、数秒の見込み【未確認】。作り始めに本番と同じ大きさで測る。
- **画像との違い**: 画像は PUT で上げ、サーバーが描き直して置き直している。動画は TUS で上げ、サーバーは確かめるだけにする。

---

## 4. 投稿との関係と、投稿をつくる画面

- 1 つの投稿は「画像（10 枚まで）」か「動画 1 本」のどちらか。両方は添えられない。
  - DB でも縛る（6.）。
  - 画面では、動画を添えたら「画像を選ぶ」を押せなくし、「動画を外すと画像を選べます」と添える。逆も同じ。
- **③ のステップの名前を「画像・動画」にする**。
  - ステップの丸の名前（compose-steps.ts の label）: 画像 → 画像・動画
  - 見出し: 画像を添えるか → 画像か動画を添えるか
  - 下の帯: 画像なしで次へ → 画像・動画なしで次へ
  - PC の札が 1 つ長くなるので、並びが 1280 で 1 行に収まるかを確かめる。
- ③ の中:
  - 「画像を選ぶ」の横に「動画を選ぶ」を置く。テンプレート・AI でつくる画像は、画像のときだけ。
  - 動画を添えたあとのカード:
    - プレビュー（再生のボタンつき。上げた直後は手元の動画、あとから開いたときは署名 URL で preload="none"）
    - 長さ・大きさ
    - 「外す」
  - 送り先ごとの印（② で選んだ SNS）:
    - 動画を送れない SNS には「● X には動画を送れません」と出す（W1 で送らないと決めた SNS と、まだ作っていない SNS）。
    - 直し方は「X を送り先から外す」か「動画を外す」。
    - いまの送り先の問題（TargetIssue）に `video_unsupported` を足し、⑤ のまとめと送れない理由にも出す。
- 動画だけの SNS（TikTok・YouTube）で動画がないときは、いまの `needs_video` のまま。
- 下書き・書きかけの控え:
  - 画像と同じく、添えた動画の ID を控えに持つ。
  - 戻すのは、上げてから 20 時間までのものだけ（RESTORE_UNATTACHED_HOURS と同じ）。
- 送った投稿を直す（配信先を足す）:
  - 動画が残っていれば、その動画で足せる。
  - 消したあと（7.）は「動画は送り終えたので消しました。もう一度選んでください」と出す。
- 投稿の画面・カレンダー・一覧:
  - サムネイルの代わりに、「▶ 0:42」の小さな札を出す。動画の最初の画面は作らない（転送量を使わないため）。
  - 投稿の画面では、押すと署名 URL で再生する。
- ネタ帳のメモには、動画を添えられない（画像 1 枚のまま）。

---

## 5. 送る SNS ごとの扱い

| SNS | 送り方 | 待ち方 | 作る順の案 |
|---|---|---|---|
| Threads | `media_type=VIDEO`、`video_url` に 1 時間の署名 URL（画像と同じ） | いまの段階で進める仕組み（staged.ts。準備中にして次の回に確かめる）。単体の器だけ | **1** |
| Instagram（リール） | `media_type=REELS`、`video_url`、`share_to_feed=true`（フィードにも出す。初期値。画面で選べるようにするかは後で） | staged.ts と同じ。器は 24 時間で切れる | **2** |
| Facebook ページ（リール） | `video_reels` の start → `rupload.facebook.com` に `file_url`（署名 URL）→ finish（`video_state=PUBLISHED`） | 状態が ready になるまで、準備中にして次の回に確かめる | **3** |
| X | `/2/media/upload` を initialize → append（5MB ずつ）→ finalize → STATUS。サーバーが Storage から読んで送る | processing_info の check_after_secs ごとに、準備中にして次の回に確かめる | **4**（W2 の確かめのあと） |
| TikTok | FILE_UPLOAD（50MB までなので 1 回で送る）。サーバーが Storage から読んで送る | status/fetch | 実装担当3（tiktok.md） |
| YouTube | 再開できるアップロード、8MB ずつ。サーバーが Storage から読んで送る（下の postVideoFor） | 1 回の関数で終わらなければ、次の回に続きから | 実装担当2（youtube.md） |

- **作る順の考え方**:
  - まず共通の土台（6. の表・3. の上げ方・2. のブラウザ・4. の画面）を作る。
  - 次に、いちばん手間の小さい Threads で、署名 URL を取りに来てもらうところまで、本物で 1 本確かめる（PM の了承を得てから）。
  - その後の進め方:
    - TikTok と YouTube は、土台ができたら postVideoFor を使って並べて進められる。
    - Instagram と Facebook は私（実装担当1）が続ける。
    - X は最後にする。
- **SNS が取りに来るとき**（Threads・Instagram・Facebook）:
  - 画像と同じく、送る直前に 1 時間の署名 URL を作る。
  - Range で読みに来るかは【未確認】。Supabase の署名 URL が Range に答えるかを、作り始めにローカルで確かめる。
- **サーバーが読んで送るとき**（X・TikTok・YouTube）:
  - 読み出しはこの 1 つの関数にまとめる。実装担当2 と合わせた形（2026-11-15）:

```ts
// src/lib/media/video-store.ts（サーバーだけ。service_role のクライアントで呼ぶ）
// 投稿に添えた動画を返す。添えていない・消したあと・ほかの投稿の動画は返さない（ID の取り違えで他人の動画を読まない）
postVideoFor(admin, postId): Promise<null | {
  mediaId: string;
  sizeBytes: number;         // サーバーが確かめたときの大きさ
  mime: "video/mp4";
  durationMs: number;
  width: number;             // 回転を当てたあとの見た目の縦横
  height: number;
  aiGenerated: boolean;      // いまは常に false（動画を AI で作る機能はない）
  readRange(start: number, endExclusive: number): Promise<Uint8Array>;
}>
```

- **readRange の読み方**:
  - Range で読めるとき:
    - 最初の呼び出しで 5 分の署名 URL を 1 回だけ作り、使い回す。
    - `Range: bytes=start-(end-1)` で読む。
    - 206 と、長さが合うかを確かめる。
  - Range が効かないとき（200 で全体が返った）:
    - そのまま全体を手元に持ち、2 回目からは切って返す。
    - 同じ関数の中で全体を何度も読まない（実装担当2 の依頼）。
- **バケットと形は列に持たない**:
  - バケットは kind で決まる（image → post-media、video → post-videos）。
  - 形は video/mp4 だけ。
- **送り先の数の上限**（1.）: 送信ジョブで、アカウントごとの 24 時間の本数を数える。
  - Facebook リールは 30 本。
  - Instagram は 50 本（資料の食い違いの少ないほう）。
  - Threads は 250 本。
  - 利用者が 1 人で予約するぶんにはまず届かない。超えそうなら、予約するときに「● Facebook のリールは 1 日 30 本まで」と出す。作るのは後でもよい。

---

## 6. 表・列・RLS・grant・Storage のポリシー

### バケット post-videos

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-videos', 'post-videos', false, 52428800, array['video/mp4']);
```

- 利用者（anon・authenticated）が直接読む・書くポリシーは置かない。
  - 上げるのは、サーバーが発行した署名つきのトークンだけ。
  - 読むのは、サーバーが作る署名 URL だけ。
- 上げるのに insert のポリシーが要るか【未確認】。
  - 要るとわかったら、`(storage.foldername(name))[1] = auth.uid()` に加えて、**引換券がある場所だけ**に絞る。
  - 引換券を見るのは security definer の関数で行う。

### media_files に足す列

| 列 | 型 | 決まり |
|---|---|---|
| kind | text not null default 'image' | `check (kind in ('image', 'video'))` |
| duration_ms | integer | `check ((kind = 'video') = (duration_ms is not null))`、`check (duration_ms is null or duration_ms between 1 and 600000)`。3〜90 秒はサーバーの定数で確かめる（Pro にしたら広げるため、DB では広く取る） |
| removed_at | timestamptz | 送り終えてファイルを消した時刻（7.）。消したあとも、投稿の画面に「動画（0:42）は消しました」と出すために行は残す |

- 決まり（check）:
  - 置き場所: `check (kind = 'image' and storage_path like '%.jpg' or kind = 'video' and storage_path like '%.mp4')`。owner_id のフォルダの check は、いまのまま。
  - 動画はネタ帳のメモ・直した画像に使わない: `check (kind = 'image' or (note_id is null and source_of is null and original_id is null and edit_base_id is null and edit is null))`
- 1 つの投稿に動画は 1 本: `create unique index media_files_one_video on media_files (post_id) where kind = 'video' and post_id is not null`
- 画像と動画を混ぜない:
  - トリガー `media_files_no_mix`（before insert or update of post_id, kind）で、同じ post_id に違う kind があれば断る。
  - 書くのはサーバーだけだが、DB でも守る。
- 権限:
  - いまの `grant select on media_files to authenticated`（RLS で本人の行だけ）のまま。新しい列も、本人が読めるだけ。
  - insert・update・delete はいまどおり利用者に付けない。
- 容量の数え方:
  - media_usage_bytes と、画像の引換券の上限は、**kind = 'image' だけ**を数えるように直す。
  - 動画を足すと、画像の 100MB の枠を食わないようにするため。

### 引換券

- media_upload_tickets に `kind text not null default 'image'` を足す。
- 新しい関数 `issue_video_upload_ticket(p_owner_id, p_storage_path, p_max_pending, p_max_unattached, p_quota_bytes, p_max_file_bytes, p_month_limit, p_global_quota_bytes)`:
  - security definer、`set search_path = ''`。
  - `revoke all ... from public, anon, authenticated, service_role` のあと、`grant execute ... to service_role` だけ。
  - 利用者ごとのアドバイザリロック（画像と同じ鍵）の中で、8. の上限を確かめて記録する。
  - 返り値:
    - 'ok'
    - 'too_many_pending'
    - 'too_many_unattached'
    - 'quota'
    - 'month_limit'
    - 'global_quota'
  - 全体の量（global）は、すべての利用者の動画の合計。ロックは全体用の鍵も取る。
- 画像の issue_media_upload_ticket は、確かめ待ちを kind = 'image' だけで数えるように直す。

### 月の本数

- media_files の行は消える（7.）ので、月の本数は別に数える。
- 表 `video_upload_counts (owner_id, month date, count)`:
  - サーバーだけが読み書きする。RLS を有効にし、ポリシーは置かない。
  - `revoke all ... from anon, authenticated`。
  - 13 か月で purge する。
- 退会したら cascade で消える。

### 利用者が直接読める・書ける経路がないこと（結合テストで確かめる。10.）

- authenticated で次のどれもできないこと:
  - post-videos のファイルの一覧
  - post-videos のファイルを読む
  - post-videos に上げる
  - 他人の media_files を select する
  - media_files に insert・update・delete する
  - media_upload_tickets と video_upload_counts を読む・書く
  - issue_video_upload_ticket を呼ぶ
- 署名つきのトークンは、発行した 1 か所にしか上げられないこと（ほかの名前に使い回せない）。

---

## 7. 上限と片付け

### 上限（利用者ごと。8. で値を決める）

| 上限 | 値の案（Free のうち） | 画像のいま |
|---|---|---|
| 確かめ待ちの引換券 | 2 本 | 10 枚 |
| 投稿に添えていない動画 | 3 本 | 20 枚 |
| 置いている動画の合計 | 300MB（引換券は 1 本 50MB で数える） | 100MB |
| 月に上げられる本数 | 20 本（8.） | なし |
| 全体（すべての利用者）の動画の合計 | 500MB | なし |

- 全体の 500MB は、Free の保存 1GB を、画像（全体）と分け合うため。
- 上限に当たったときの文は、「置ける動画の合計（300MB）に近づいています。送り終えた動画は 1 日で消えます。要らない下書きの動画を外してください」の形（画像の文に合わせる）。
- 全体の上限に当たったときは、利用者のせいに見えないように書く: 「いま動画を受け付けられません。時間をおいてもう一度お試しください」。運営者に知らせる（D23 の上限の 80% の知らせと同じ仕組み）。

### 片付け（毎日の cleanup-media のジョブで、post-videos も見る）

cleanup_media_candidates を広げる（kind を見て、消すファイルのバケットを返す。返り値に bucket を足す）。

| 何を | いつ消す |
|---|---|
| 確かめ待ちの引換券と、その場所のファイル | 1 日（画像と同じ） |
| 記録のない post-videos のファイル（確かめる前に止まった・退会した人のもの） | 1 日（画像と同じ） |
| 投稿に添えていない動画 | 1 日（画像と同じ） |
| 下書きの投稿に添えた動画 | 消さない（投稿を消すと、添えていない動画になって 1 日で消える）。置ける量の上限で抑える |
| 送った投稿の動画 | 配信先に pending・preparing・publishing が 1 つもなく、最後の更新から **1 日**。送れなかった配信先（failed）が残っていれば **7 日**（送り直せるように）。ファイルを消して removed_at を入れる。行は投稿と一緒に消える |

- **preparing を「送り中」に数える**:
  - YouTube の再開できるアップロードと、Threads・Instagram・Facebook の処理待ちの間に消すと、続きを送れなくなる。
  - いまの画像の片付けは、pending・publishing だけを見て、preparing を数えていない。
  - 送り終えて 30 日の画像なので実害はまずないが、同じ直しを画像にも入れる。PM に別に報告する。
- 送ったあとに配信先を足して（4.）送り直すときは、removed_at が入っていない間だけ。
- **退会**:
  - auth.users からの cascade で、media_files・引換券・月の本数が消える。
  - Storage のファイルは、記録のないファイルとして翌日の片付けで消える（画像と同じ。プライバシーポリシーの退会の書き方も画像と同じ）。
- **purge_expired_data**: video_upload_counts の 13 か月を足すだけ。動画のファイルは上の片付けで消える。
- **SNS を外したとき・投稿を取り消したとき**: 動画のファイルは、送った投稿の決まりのまま（1 日で消える）。特別には扱わない。

---

## 8. 費用と、月 3,000 円の予算との関係

前提:
- 1 本 40MB（60 秒）。
- 1 本あたりの転送量:
  - SNS が取りに来る（Threads・Instagram・Facebook）: 送る数だけ、各 1 回。
  - サーバーが読む（X・TikTok・YouTube）: 送る数だけ、各 1 回。
  - 利用者のプレビュー: 上げた直後は手元の動画なので 0。あとから投稿の画面で再生すると 1 回。
- 送り先を 4 つ、再生 1 回とすると、1 本で約 5 回 × 40MB = **約 0.2GB**。

| 利用者（動画を使う人） | 本数（月） | 転送量（月） | 置いている量 | Supabase |
|---|---|---|---|---|
| オーナーだけ | 8 本 | 約 1.6GB | 約 0.1〜0.2GB | **Free で足りる**（5GB・1GB） |
| オーナーだけ（上限の 20 本まで使う） | 20 本 | 約 4GB | 約 0.3GB | Free の 5GB の内（送り先が 4 つのとき。5 つ以上を毎回選ぶと超えうる） |
| 10 人（段階 ②） | 80 本 | 約 16GB | 約 1.5GB | **Pro**（$25。段階 ② で Pro にする予定に含まれる） |
| 100 人（段階 ③） | 800 本 | 約 160GB | 約 15GB | Pro の範囲（250GB・100GB） |

- **月の上限の案は、オーナーだけのうちは 20 本**（7. の表の値）。転送量が Free の 5GB を超えないようにするため。
  - Free は超えても請求されない。ただ、猶予のあとで制限がかかり、組織のすべてのプロジェクトに及ぶ。
  - 段階 ② で Pro にしたら、上限を見直す。
- **Pro にする目安**: roadmap の段階 ②（招待制）に進むとき。
  - 動画のためだけに先に Pro にはしない（オーナーだけなら Free で足りる）。
  - 4.24 の「2〜3 人を超えたら」は、段階 ② の 10 人に含まれる。
- Vercel:
  - サーバーが Storage から読んで SNS へ送る分（X・TikTok・YouTube）は、関数の外への通信。
  - Vercel の転送量に数えられるかは【未確認】。Hobby の 100GB に対して、オーナーだけなら月 1GB 未満。
- SNS の API の費用:
  - X: 投稿 $0.015 のまま。動画を上げる操作の料金の行は資料にない【未確認】。作り始めの 1 本で、使った額を X の Developer Console で確かめる。
  - ほかの SNS は無料。
- 予算（月 3,000 円）との関係:
  - オーナーだけのうちは、動画で増える費用は 0 円（Free の範囲。X は 1 本 約 2 円）。
  - 段階 ② の Pro の費用は、動画だけの理由ではないので、roadmap の段階の費用のまま。
- docs/architecture.md の 7 の費用の表に、動画の行を足す（作るとき）。

---

## 9. 法務

**② に当たる**（新しく預かる情報）。
- 動画は、いままで預かっていなかった種類の情報。顔・声・写り込んだ人や場所が入りやすい。
- 送り先は同じ SNS でも、新しく動画を送る（新しい情報の新しい送り先への提供）。
- いまの利用者はオーナーだけなので、SNS のコメント（4.70）と同じく noticeWaived にし、本番に出す日から施行する案。施行日は PM が合わせる。

変える文の案（前 → 後。ほかの条は変えない）:

| ページ | 場所 | 前 | 後 |
|---|---|---|---|
| プライバシーポリシー | 第 1 条 預かる情報（行を足す） | （なし） | 「投稿に添えた動画」: 動画（本サービスが MP4 の形にそろえたもの）、長さ・縦横・大きさ。撮影の場所・日時・機種などの情報は、利用者の端末で形をそろえるときに取り除き、本サービスには送りません ／ どこから: 利用者が選んだ動画 |
| プライバシーポリシー | 送り先 Threads・Instagram・Facebook の「送るもの」 | 投稿の本文、添えた画像と画像の説明文（…が画像を取りに来るための、1 時間で切れる URL）、… | 投稿の本文、添えた画像と画像の説明文、または添えた動画（…が画像や動画を取りに来るための、1 時間で切れる URL）、… |
| プライバシーポリシー | 送り先 X の「送るもの」（W1 で X に送ると決めたとき） | 投稿の本文、添えた画像と画像の説明文、… | 投稿の本文、添えた画像と画像の説明文、または添えた動画、… |
| プライバシーポリシー | 送り先 Supabase の「使い道」 | データベース、ログイン、画像の保存。… | データベース、ログイン、画像と動画の保存。… |
| プライバシーポリシー | 保存期間（行を足す） | （なし） | 「投稿に添えた動画: すべての送り先に送り終えて 1 日で消す（送れなかった送り先が残っていれば 7 日）。投稿に添えなかった動画は 1 日で消す。退会したときは、翌日までに消す」 |
| プライバシーポリシー | 保存期間（行を足す） | （なし） | 「動画を上げた本数（月ごと）: 13 か月で自動で消す。上限の計算のため」 |
| 利用規約 | 料金と上限 | （いまの文） | 末尾に「動画は、長さ・大きさ・本数に上限があります」を足す |
| 利用規約 | してはいけないこと（足す） | （なし） | 「権利を持っていない音楽・映像を含む動画や、写っている人の同意を得ていない動画を、本サービスから SNS に送ること」 |

- 知らせの文の案（LEGAL_VERSIONS の summary）:
  - プライバシーポリシー: 「投稿に動画を添えられるようにしました。動画を預かり、送り先の SNS に送ります。送り終えて 1 日で消します（預かる情報・送り先・保存期間）」
  - 利用規約: 「動画の上限と、権利のない音楽や同意のない人が写った動画を送らないことを足しました（料金と上限・してはいけないこと）」
- TikTok・YouTube への送り先の行は、それぞれのメモ（tiktok.md・youtube.md）で足す。
  - 版を 1 つにまとめるか分けるかは、PM が施行の時期で決める。
- docs/legal.md に、② に当たる理由と上の表を記録する（作るとき）。

---

## 10. 作る順とテスト

### 作る順

| # | やること | テスト |
|---|---|---|
| 1 | DB: バケット・media_files の列・決まり・トリガー・引換券の kind・issue_video_upload_ticket・video_upload_counts・片付けの拡張（preparing を含む）・画像の数え方の直し | 結合テスト（下） |
| 2 | サーバー: requestVideoUpload・confirmVideoUpload・MP4 の箱の確かめ・postVideoFor（readRange） | 単体（小さな見本の MP4。下）・結合 |
| 3 | ブラウザ: 読み取り・作り直し・長さの選択・TUS・進み具合・使えないブラウザ（mediabunny・tus-js-client を足す） | 単体（判定・ビットレートの計算）・ブラウザの確かめ |
| 4 | 画面: ③ 画像・動画、送り先の印（video_unsupported）、投稿の画面の再生、書きかけの控え。見た目の案を PM に出してから | 画面の組み立ての単体・スクショ（390・1280） |
| 5 | Threads に動画を送る（staged.ts を広げる）→ PM の了承を得て、オーナーの Threads に 1 本 | 単体（送る中身）・本物 1 本 |
| 6 | Instagram リール → Facebook リール | 同じ |
| 7 | X（W2 の確かめのあと） | 同じ |
| 8 | 法務の版・legal.md・architecture.md（4.24 を差し替える節）・deploy.md（本番のバケットの作成とファイルの上限の設定） | 法務の版のテスト |

- 2 が済んだら、postVideoFor を実装担当2（YouTube）と実装担当3（TikTok）に渡せる。
- 1〜4 で、本物の SNS を呼ばずに、動画を上げて添えるところまで動く。

### 結合テスト（tests/post-videos.integration.test.ts）

- 他人の動画を読めない:
  - 他人の media_files（kind = 'video'）を select できない。
  - post-videos のファイルを、authenticated・anon で一覧・ダウンロードできない。
  - 署名 URL を作れない。
- 上げられない:
  - authenticated で post-videos に直接上げられない（標準の upload と TUS の両方）。
  - 署名つきのトークンで、ほかの名前に上げられない。
- 上限:
  - 確かめ待ちは 2 本まで。
  - 添えていない動画は 3 本まで。
  - 合計の量・月の本数・全体の量に当たると、それぞれの返り値になる。
  - 同時に 5 本頼んでも、上限を超えて発行しない（ロック）。
- 決まり:
  - 1 つの投稿に動画は 2 本添えられない。
  - 画像と動画を混ぜられない。
  - ネタ帳のメモに動画を添えられない。
  - kind と置き場所の拡張子が合わないと入らない。
- 数え方:
  - 動画は画像の 100MB の枠に数えない。
  - 画像の確かめ待ちに、動画の引換券を数えない。
- 片付け:
  - 次のものは 1 日で候補になる。
    - 添えていない動画
    - 確かめ待ちの引換券
    - 記録のないファイル
  - 送り終えた動画は 1 日、failed が残っていれば 7 日。
  - **preparing・pending・publishing の配信先があれば消さない**。
  - removed_at が入る。postVideoFor は消したあとの動画を返さない。
- 退会: 行が消え、ファイルは記録のないファイルとして候補になる。
- 権限: issue_video_upload_ticket・cleanup を authenticated・anon が呼べない。新しい表を読めない・書けない。

### 単体テスト

- 判定（純粋な関数）:
  - 長さ・大きさ・音声のコーデックから「受け付けない理由」を出す。
  - ビットレートの計算（90 秒で 50MB に収まる）。
  - 長さの範囲（90 秒を超えたときの初期値・3 秒未満にできない）。
- サーバーの箱の確かめ:
  - 見本の MP4（数十 KB。tests/fixtures/video/ に置く）で次を確かめる。
    - 正しいもの
    - moov が後ろ
    - edts あり
    - HEVC
    - Opus
    - udta に位置の情報
    - 長すぎ・短すぎ
    - 縦横が大きすぎ
  - 見本は、作り始めに ffmpeg で作り、作ったコマンドを README に残す。
- postVideoFor:
  - 206 で読めたとき・200 で全体が返ったとき（2 回目から読み直さない）。
  - 添えていない動画を返さない。

### ブラウザの確かめ（作り始めと、3・4 が済んだとき）

| 端末 | 確かめる動画 |
|---|---|
| iPhone の Safari（いまの iOS の版） | カメラの 4K60 HEVC（MOV）・30 秒、2 分の動画（長さを選ぶ）、横長の動画、画面録画 |
| Mac の Safari | iPhone から AirDrop した HEVC、音声なしの動画 |
| Mac・Windows の Chrome | H.264 の MP4、HEVC の MOV（Windows で読めないときの文）、WebM（Android の画面録画） |
| Android の Chrome | カメラの動画 |
| Android の Firefox | 「使えないブラウザ」の文が出ること |

確かめること:
- 作り直しにかかる時間（90 秒の動画で）。
- できた MP4 が 2. の形か（サーバーの確かめを通るか）。
- 音が出るか（Safari の AAC の不具合を避けられているか）。
- 上げ途中で通信を切って戻したとき、続きから上がるか。

---

## 未確認のまとめ（作り始めに確かめる）

- X が 1080×1920 を受け付けるか（W2。本物 1 本、PM の了承のあと）
- 次の SNS が、音声なし・44.1kHz の音声の動画を受け付けるか（本物 1 本ずつ）
  - Facebook リール
  - Instagram リール
- mediabunny が edit list を書き出さないか、Node で箱を読めるか（ローカルで）
- Supabase の署名つきのトークンで、TUS を使ってポリシーなしで上げられるか（ローカルで）
- Supabase の署名 URL が Range に答えるか（ローカルと本番で）
- iPhone の Safari で、90 秒の 4K60 を作り直すのにかかる時間
- AAC の不具合が直った Safari の正式版の番号
- Vercel で、関数から外へ送る通信が転送量に数えられるか
- X の動画を上げる操作の料金
- Instagram の投稿の上限が 24 時間で 50 か 100 か

---

## 11. 作ってみて変えたこと（2026-11-15、feat/video。architecture.md の 4.73）

- **TUS の送り先**: 署名つきのトークン（x-signature）で上げるときは `/storage/v1/upload/resumable/sign`。付けない入口は storage.objects の RLS を見るので、ポリシーのない post-videos は 403 になる（【未確認】だった「ポリシーなしで上がるか」は、/sign なら上がる、とローカルで確かめた）。トークンは発行した場所にしか使えない（ほかの名前・バケットには上がらない）
- **メタデータ**: mediabunny は tags を指定しないと元の動画のタグ（撮影の場所など）を書き写す。tags を空にした
- **edit list**: 音声をコピーすると、AAC の頭の空白（1024 サンプル）で音声のトラックに edts が書かれ、サーバーの確かめを通らなかった。copy の boundaryPolicy: shrink と shiftTolerance: Infinity で、音声の始まりを 0 に寄せた（Chrome で確かめた。ffprobe で H.264 High・30fps 固定・2 秒ごとのキーフレーム・AAC-LC を確かめた）
- **引換券の印（consumed_at）**: 自動のセキュリティの確かめの指摘（MEDIUM）。署名つきの URL・トークンは 2 時間使えるので、断った・外した場所に上げ直すと、上限に数えられないファイルが 1 日残った。引換券を消さずに印を付け、記録のない場所のファイルを量に数え、片付けがすぐ消す。画像も同じ作りにそろえた
- **消した動画の印**: 送り終えて動画を消した投稿に送り先を足して送り直すと、文だけで送ってしまう道があった。消した動画の行（removed_at）は外すだけでは残し、送信ジョブと保存（予約・今すぐ送る）で「動画を選び直して」と止める。画像を添えるとき・別の動画に入れ替えるときは外す
- **全体の上限**: 500MB は 2 人で使い切れる（自動のセキュリティの確かめの指摘）。段階 ② の Supabase Pro に進むときに 50GB に上げる案を、PM がオーナーに確かめている
- **見え方の欄**: 動画を映さず、「▶ 動画（0:42）を添えて送ります」の 1 行（最初の 1 枚の静止画は、開き直したときに動画を読み込むことになるのでやめた）
- **送る順**: X の部品も作った（5MB ずつ append → STATUS）。SNS.x.video は W2 の確かめまで false。本物の確かめは 4 つをまとめて 1 回（deploy.md の 29-5）
- **法務の版**: YouTube と同じ 2026-11-17 の 1 つの版にまとめる（1 日 1 版）
- **PMO の確かめ（2026-11-15）での直し**:
  - 上げている途中の「やめる」で、引換券とファイルが残り、1 日動画を追加できなくなった。やめたらサーバーで片付ける（cancelVideoUpload）、上げ終えたら「やめる」を隠す、確かめのあとにやめていたら外す
  - 月の本数は、確かめを通った動画だけを数える（media_files に動画の行ができたときにトリガーで数える。前は引換券を出すたびに数えていた）
  - 使った引換券の場所のファイルは、「2 時間は 50MB」ではなく、残っているファイルの実際の大きさで量に数える（やめてファイルを消せば量が元に戻る。上げ直されたら数える）。画像も同じ
  - 上限は整える前に確かめる（video_upload_check。読むだけ）。引換券のときの確かめは本当の守りとして残す
  - 準備中の文を、動画のときは「動画を処理しています（数分かかることがあります）」に。見え方の欄で、動画を送れない SNS は「X には動画を送れません」
  - 送り終えて動画を消した投稿に送り先を足したときは、③ と ⑤ に「● 要確認 添えていた動画は、送り終えたので消しました。動画を選び直してください」を先に出す
  - 整えている・上げている間は、「リセット」「下書きに保存する」も押せない
