// 用語解説（要求 F12、docs/architecture.md の 4.45）。画面に出てくるマーケティング用語と、運用しながら身につけたい基本の考え方を、素人にもわかる言葉で説明する。
// key は <Term k="...">・/glossary/<key>（詳細ページ）・前からの /glossary#key のリンクが使うので変えない。将来は DB（glossary_terms）へ移し、AI による追加解説とつなげる。

// 「くわしく」を開くと出る中身。段落・箇条書き・比べる表（表はスマホでは行ごとのカードにする）
export type GlossaryBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; caption: string; head: string[]; rows: string[][] };

export type GlossaryTerm = {
  label: string;
  reading?: string;
  // いつも見せる説明（2〜3 文）。<Term> のポップアップにも出す
  summary: string;
  example?: string;
  // 長い説明・表・例（用語集の「くわしく」を開くと出る）
  details?: GlossaryBlock[];
  // 関係する語（用語集の「関連:」。key が用語集にあることをテストで確かめる）
  related?: string[];
};

export const glossary = {
  persona: {
    label: "ペルソナ",
    summary:
      "宣伝したいものを届けたい「たった一人の典型的なお客さん像」。年齢・職業・悩み・SNS の使い方まで具体的に決めると、投稿の言葉選びがぶれなくなります。",
    example: "例:「子どもの習い事を探している 30 代の会社員。夜 22 時ごろ Instagram を眺めている」（教室の場合）。「残業続きで家計簿が続かない 28 歳。夜 23 時ごろ X を見ている」（アプリの場合）",
    related: ["contentPillar", "toneAndManner"],
  },
  conversion: {
    label: "コンバージョン",
    summary:
      "見てもらうだけでなく、こちらが望む行動まで進んでもらうこと。行き先のページで「買う」「申し込む」「予約する」「ダウンロードする」などがそれに当たります。yabumi では、投稿から行き先へ進んだ回数（短縮リンクのクリック）と、その先の成果を測ります。",
    example: "例: お店なら予約、教室なら体験の申し込み、ネットショップなら注文、アプリならダウンロード。",
    related: ["marketingFunnel", "kgi", "shortLink"],
  },
  kgi: {
    label: "KGI",
    reading: "ケージーアイ",
    summary: "最終的にたどり着きたいゴールの数字。例:「3 か月で体験の申し込み 30 件」「3 か月で 1,000 ダウンロード」。日々追う小さな数字は KPI と呼びます。",
    related: ["kpi", "roadmap"],
  },
  kpi: {
    label: "KPI",
    reading: "ケーピーアイ",
    summary: "KGI に向かう途中で、日々追いかける小さな目標の数字。",
    example: "例:「週 5 回投稿する」「投稿から予約のページへの訪問を月 300 回」。",
    related: ["kgi", "roadmap", "marketingFunnel"],
  },
  impression: {
    label: "インプレッション",
    summary: "投稿が画面に表示された回数。同じ人が 2 回見れば 2 と数えます。",
    related: ["marketingFunnel", "awareness"],
  },
  awareness: {
    label: "認知",
    reading: "にんち",
    summary:
      "宣伝したいもの（お店・商品・作品・アプリなど）の存在を知ってもらうこと。買う・申し込む・使うの手前の、いちばん最初の段階です。始めたばかりのアカウントは、まず認知を広げることを目標にするのが一般的です。",
    example: "例:「駅前でパン教室といえば、あの教室」と思い出してもらえる状態。",
    related: ["marketingFunnel", "impression"],
  },
  contentPillar: {
    label: "投稿の柱",
    summary:
      "アカウントで繰り返し発信する「投稿の種類」のこと。3〜4 本決めておくと、毎回ゼロからネタを考えずに済み、見る人にも「何のアカウントか」が伝わります。柱ごとに割合も決めると、宣伝ばかりになるのを防げます。",
    example: "例（焼き菓子のネットショップ）:「季節のお菓子 40%・作っている裏側 30%・お店の紹介 20%・お客さんの声 10%」。",
    related: ["toneAndManner", "persona"],
  },
  hashtag: {
    label: "ハッシュタグ",
    summary:
      "投稿に付ける「# から始まる言葉」。押すと同じ言葉の付いた投稿が並ぶので、その話題が好きな人に見つけてもらう入り口になります。人が多すぎるタグ（#おすすめ など）はすぐ流れて埋もれ、少なすぎるタグはだれも見ていません。届けたい相手が実際に見ている、話題のはっきりしたタグを、ネタに合うときだけ付けます。宣伝のためだけのタグ（#拡散希望 など）は嫌われるので使いません。",
    example: "例: お客さんに届けたいなら、作り手の言葉（#ハンドメイド作家 など）より、買う人の側の言葉（#手作りアクセサリー など）。",
    related: ["contentPillar", "ugc"],
  },
  toneAndManner: {
    label: "トンマナ",
    reading: "トーン・アンド・マナー",
    summary:
      "投稿の口調や雰囲気の決まりごと。です・ます調か、絵文字を使うか、専門用語を避けるかなどを決めておくと、誰が書いても・いつ書いても同じアカウントらしさが出ます。",
    example: "例:「です・ます調。親しみやすく。絵文字は 1 投稿に 1 つまで」。",
    related: ["contentPillar", "persona"],
  },
  roadmap: {
    label: "ロードマップ",
    summary:
      "最終の目標（KGI）までの道のりを、週ごとのやることに分けて並べたもの。「今週は何をすればいいか」が見えるので、迷わずに続けられます。やってみて合わなければ、いつでも直します。",
    example: "例: 目標「1 か月で 12 本投稿する」→ 1 週目「投稿の柱ごとに 1 本ずつ書く」、2 週目「反応のよかった柱でもう 1 本」。",
    related: ["kgi", "kpi"],
  },
  proAccount: {
    label: "プロアカウント",
    summary:
      "Instagram の、仕事や活動の発信に使う種類のアカウント（ビジネスとクリエイターの 2 つ）。無料で、いつでも切り替えたり戻したりできます。投稿の閲覧数などが見られるようになり、yabumi のようなツールから投稿できるのはこの種類だけです。",
    example: "切り替え方: Instagram のアプリ →「設定とアクティビティ」→「アカウントの種類とツール」→「プロアカウントに切り替える」。迷ったらクリエイターを選びます。",
    related: ["snsTraits"],
  },
  facebookPage: {
    label: "Facebook ページ",
    summary:
      "お店・サービス・作品などのために作る、Facebook の公開のページ。個人のプロフィールとは別のものです。yabumi のようなツールから Facebook に投稿できるのはページだけで、個人のプロフィールには投稿できません。",
    example: "作り方: Facebook →「メニュー」→「ページ」→「新しいページを作成」。お店・サービス・作品の名前で作るのがおすすめです。",
    related: ["snsTraits"],
  },
  newsletter: {
    label: "ニュースレター",
    summary:
      "登録してくれた読者に、メールで届ける定期的なお便り。SNS の投稿はおすすめの表示に左右されますが、ニュースレターは読者の受信箱に直接届きます。Substack はニュースレターを書いて届けるためのサービスです。",
    example: "例:「月に 1 回、新作と教室の予定を登録者に届ける」。",
    related: ["ownedAudience", "ownedMedia"],
  },
  ownedAudience: {
    label: "自分で持てる読者",
    summary:
      "SNS の運営の都合（表示の仕組みの変更やアカウントの停止）に左右されずに、自分から届けられる読者のこと。ニュースレターの読者のメールアドレスが代表です。SNS のフォロワーは、SNS の側の持ち物に近いと考えます。",
    related: ["newsletter", "ownedMedia"],
  },
  payPerUse: {
    label: "X の API の費用",
    summary:
      "X は、yabumi のようなツールから投稿するとき、1 本ごとにお金がかかります（使った分だけ払う方式）。本文に URL がない投稿は 1 本 $0.015（約 2 円）、URL がある投稿は 1 本 $0.20（約 30 円）。yabumi 全体で月の上限を決めていて、超えたら自動では送らず、手で投稿してもらいます。",
    example: "例: 月 30 本、すべて URL なしなら $0.45（約 70 円）。すべて URL ありなら $6（約 900 円）。",
    related: ["snsTraits", "shortLink"],
  },
  buildInPublic: {
    label: "Build in Public",
    reading: "ビルド・イン・パブリック",
    summary:
      "商品・作品・アプリを作っている途中の様子（迷ったこと、直したこと、なぜそう作ったか）を、そのまま SNS で見せる発信のしかた。完成した宣伝より身近に感じてもらいやすく、作り手を応援してくれる人が増えると、出したときに買ってもらう・使ってもらうきっかけになります。",
    example: "例:「新作のマグの色、3 回焼き直しました。釉薬の量をこう変えました」。アプリなら「通知が 2 回届く不具合に 3 日詰まりました。原因は〇〇でした」。",
    related: ["contentPillar", "ugc"],
  },
  storeListing: {
    label: "ストアページ",
    summary: "App Store や Google Play の、アプリの紹介ページ。ここからダウンロードされます（宣伝するものがアプリのとき）。",
    related: ["ownedMedia", "campaignLink"],
  },
  shortLink: {
    label: "短縮リンク",
    summary:
      "長い URL の代わりに使う、短いリンク。yabumi の短縮リンクは、押されると回数を数えてから本当の行き先（予約のページ・ネットショップ・ストアページなど）へ移ります。SNS ごとに別のリンクを使うと、どの SNS から何人来たかがわかります。",
    example: "例: go.yabumi.app/Ab3dE5fG を押すと、お店の予約のページが開く。",
    related: ["campaignLink", "conversion"],
  },
  correlation: {
    label: "相関",
    reading: "そうかん",
    summary:
      "2 つの数字が一緒に動くこと。「投稿した日は注文が多い」は相関で、投稿のおかげとは限りません（週末だった、ほかで紹介された、なども重なります）。続けて見て、同じ傾向がくり返すかを確かめます。",
    related: ["kpi"],
  },
  campaignLink: {
    label: "キャンペーンリンク",
    summary:
      "どこから来た人かを、行き先のサイトや解析の側でも見分けられるよう、URL に印を付けたもの。ふつうのサイトや予約・ネットのお店のページでは utm_source などを付けます（アプリなら、App Store では pt と ct、Google Play では utm_source）。yabumi の短縮リンクは、行き先に自動で付けます。",
    example: "例: お店のサイトの解析（Google アナリティクスなど）で、どの SNS から何人来たかが見られる。アプリなら、App Store Connect の「キャンペーン」で SNS ごとのダウンロード数が見られる（数が少ないうちは出ません）。",
    related: ["shortLink"],
  },
  dns: {
    label: "DNS",
    reading: "ディーエヌエス",
    summary:
      "ドメイン（例: example.com）を、実際につながる先に結びつける「住所録」。ドメインを買ったサービス（お名前.com や Cloudflare など）の管理画面で、1 行ずつ書き足して設定します。書き足してから世界中に届くまで、数分〜数時間かかることがあります。",
    related: ["cname", "subdomain"],
  },
  cname: {
    label: "CNAME",
    reading: "シーネーム",
    summary: "DNS の行の種類の 1 つ。「このサブドメインは、あちらの名前と同じ場所につなぐ」という意味です。yabumi の短縮リンクを自分のドメインで使うときは、この行を 1 つ足します。",
    example: "例: 名前 go、値 cname.vercel-dns.com",
    related: ["dns", "subdomain"],
  },
  subdomain: {
    label: "サブドメイン",
    summary:
      "持っているドメインの前に、好きな言葉を付けて作る別の住所。追加の料金はかかりません。今のホームページやメールに影響しないので、短縮リンクには go.example.com のようなサブドメインを使います。",
    example: "例: example.com を持っていれば、go.example.com や link.example.com が作れる。",
    related: ["dns", "cname"],
  },
  marketingFunnel: {
    label: "マーケティングファネル",
    reading: "ファネルは「じょうご」のこと",
    summary:
      "お客さんが、宣伝したものを知ってから行動し、また来てくれるまでの段階を、じょうごの形にたとえたもの。先の段に進むほど人数は減るので、どの段で止まっているかを見ると、次に直すところがわかります。",
    details: [
      {
        kind: "table",
        caption: "ファネルの段と、yabumi で見る数字",
        head: ["段", "お客さんの様子", "yabumi で見る数字"],
        rows: [
          ["知る（認知）", "投稿がタイムラインやおすすめに出て、目にとまる", "インプレッション（閲覧数）"],
          ["興味を持つ", "いいね・保存をしたり、プロフィールを見に行ったりする", "各 SNS の画面で見られる反応"],
          ["比べる", "くわしく知りたくなり、サイトや予約のページを見に行く", "短縮リンクのクリック"],
          ["行動する（コンバージョン）", "予約する・買う・申し込む・ダウンロードする", "手で記録する成果、ストアのダウンロード"],
          ["続ける", "また来る、ファンになる、人に勧める・口コミを書く", "フォロワーの数、お客さんの投稿（UGC）"],
        ],
      },
      {
        kind: "p",
        text: "始めたばかりのうちは、まず上の段（知ってもらう）を太くします。見てもらえるようになったら、クリックから行動へのつながりを見ます。全部の段を一度に良くしようとしなくて大丈夫です。",
      },
    ],
    related: ["awareness", "impression", "shortLink", "conversion", "ugc"],
  },
  tripleMedia: {
    label: "トリプルメディア",
    summary:
      "情報を届ける場所を、オウンド（自分で持つ）・アーンド（人が広めてくれる）・ペイド（お金を払って載せる）の 3 つに分ける考え方。それぞれ得意なことが違うので、組み合わせて使います。",
    details: [
      {
        kind: "table",
        caption: "3 つのメディアの違い",
        head: ["種類", "どんなもの", "お店の例", "アプリの例", "得意なこと", "苦手なこと"],
        rows: [
          ["オウンド", "自分で持っていて、自由に出せる場所", "お店のサイト、ニュースレター、SNS のアカウント", "アプリのサイト、ストアページ、開発の記録のブログ", "好きなことを書け、費用が少ない", "見てもらえるまで時間がかかる"],
          ["アーンド", "ほかの人が自分から話題にしてくれる場所", "お客さんの口コミや写真、グルメサイトのレビュー", "ストアのレビュー、使った人の紹介の投稿", "売り手の宣伝より信じてもらいやすい", "こちらの思いどおりにはならない"],
          ["ペイド", "お金を払って載せてもらう場所", "SNS の広告、地域の情報誌の広告", "SNS やストアの検索結果の広告", "早く、狙った相手に届く", "払うのをやめると届かなくなる"],
        ],
      },
      {
        kind: "p",
        text: "SNS のアカウントはオウンドに入れることが多いですが、だれに表示するかは SNS が決めます。ニュースレターのような「自分で持てる読者」も少しずつ育てておくと安心です。",
      },
    ],
    related: ["ownedMedia", "earnedMedia", "paidMedia", "ownedAudience"],
  },
  ownedMedia: {
    label: "オウンドメディア",
    summary:
      "自分で持っていて、中身や出し方を自分で決められる発信の場所。お店のサイト・ブログ・ニュースレター、SNS のアカウントなどです。お金はあまりかかりませんが、見てもらえるようになるまで時間がかかります。",
    example: "例: お店のサイトのお知らせ、教室のニュースレター。アプリなら、紹介のサイトやストアページ。",
    related: ["tripleMedia", "earnedMedia", "paidMedia", "newsletter"],
  },
  earnedMedia: {
    label: "アーンドメディア",
    summary:
      "お客さんや記者など、ほかの人が自分から話題にしてくれる場所。口コミ・レビュー・紹介記事・お客さんの投稿（UGC）などです。売り手の宣伝より信じてもらいやすい一方、こちらの思いどおりにはなりません。",
    example: "例: 来てくれたお客さんが Instagram に載せたパンの写真。アプリなら、ストアのレビューや、使った人の紹介の投稿。",
    related: ["tripleMedia", "ugc", "ownedMedia", "paidMedia"],
  },
  paidMedia: {
    label: "ペイドメディア",
    summary:
      "お金を払って、決まった場所や相手に載せてもらうもの。SNS の広告、検索の広告、雑誌や情報誌の広告、インフルエンサーへの依頼などです。早く・狙った相手に届けられますが、払うのをやめると届かなくなります。",
    example: "例: 近所に住む 30 代に向けて、Instagram の広告を 1 週間出す。アプリなら、ストアの検索結果に出す広告。",
    related: ["tripleMedia", "organicVsAds", "ownedMedia", "earnedMedia"],
  },
  ugc: {
    label: "UGC",
    reading: "ユージーシー",
    summary:
      "お客さんや使う人が、自分から投稿してくれる口コミ・写真・動画のこと（User Generated Content の略）。売り手の宣伝より信じてもらいやすく、アーンドメディアの代表です。",
    details: [
      { kind: "p", text: "頼み方の例:" },
      {
        kind: "list",
        items: [
          "お店のレジ横に「#こむぎ日和 を付けて載せてもらえたら、うれしいです」と小さなカードを置く",
          "アプリなら、投稿で「使っている画面を見せてください」と呼びかける",
          "載せてくれた人には、いいねやコメントでお礼を伝える",
        ],
      },
      {
        kind: "p",
        text: "お客さんの投稿を、自分のアカウントや広告に無断で載せてはいけません。写真や文の権利は、投稿した人にあります。載せたいときは、本人に聞いて許可をもらい、だれの投稿かを書き添えます。",
      },
      {
        kind: "p",
        text: "お礼（値引きや品物）と引きかえに投稿してもらうときは、「#PR」などで宣伝だとわかるように書いてもらいます。宣伝であることを隠すと、頼んだ側（お店やアプリの作り手）が景品表示法の違反になります（ステルスマーケティングの規制。2023 年 10 月から）。",
      },
    ],
    related: ["earnedMedia", "hashtag", "tripleMedia"],
  },
  organicVsAds: {
    label: "オーガニック投稿と広告",
    reading: "オーガニックは「自然な」の意味",
    summary:
      "オーガニック投稿は、お金を払わずにふつうに投稿すること。広告は、お金を払って、まだフォローしていない人にも投稿を見せてもらうことです。yabumi はいま、オーガニック投稿を続けるのを助ける道具です（広告を出す機能は準備中）。",
    details: [
      {
        kind: "table",
        caption: "オーガニック投稿と広告の違い",
        head: ["比べること", "オーガニック投稿", "広告"],
        rows: [
          ["お金", "かからない（作る手間はかかる）", "表示した回数やクリックに応じてかかる"],
          ["届く範囲", "主にフォロワーと、SNS がおすすめに出した人", "払った分だけ、狙った人（地域・年代・好み）に届く"],
          ["続く長さ", "投稿は残り、続けるほどアカウントに人が集まる", "払うのをやめると、すぐに届かなくなる"],
          ["向いている場面", "信頼を少しずつ育てる、ファンを作る", "開店やセールなど、決まった時期に一気に知らせる"],
        ],
      },
      {
        kind: "p",
        text: "まずはオーガニック投稿で、どんな投稿の反応がよいかを確かめておくと、広告を出すときに、反応のよかった投稿を選べてお金をむだにしにくくなります。",
      },
    ],
    related: ["paidMedia", "tripleMedia", "impression"],
  },
  seoVsSns: {
    label: "SEO と SNS の違い",
    reading: "SEO はエスイーオー",
    summary:
      "SEO は、Google などの検索で上のほうに出るように、サイトの中身を整えること。探している人に見つけてもらう方法です。SNS は、タイムラインやおすすめで、まだ探していない人と出会う方法です。",
    details: [
      {
        kind: "table",
        caption: "SEO と SNS の違い",
        head: ["比べること", "SEO（検索）", "SNS"],
        rows: [
          ["出会い方", "「駅前 パン教室」のように、探している人が見つける", "タイムラインやおすすめで、たまたま出会う"],
          ["効き始めるまで", "数か月かかることが多い", "投稿したその日から見てもらえることがある"],
          ["続く長さ", "上のほうに出れば、長く見つけてもらえる", "1 本の投稿が見られるのは、多くは数時間〜数日"],
          ["向いていること", "いま必要としている人に届く", "まだ知らない人に知ってもらう"],
        ],
      },
      {
        kind: "p",
        text: "組み合わせ方の例: SNS で知ってもらい、くわしいことはサイトやブログに書いて、短縮リンクで案内します。サイトの記事は検索からも見つけてもらえるので、両方が助け合います。",
      },
    ],
    related: ["tripleMedia", "shortLink", "awareness"],
  },
  snsTraits: {
    label: "SNS ごとの特徴",
    summary:
      "SNS ごとに、見ている人・好まれる中身・広がり方・リンクの扱いが違います。全部に同じ文を出すより、それぞれに合わせて少しずつ変えると届きやすくなります。仕様は変わることがあるので、気になるときは各 SNS の案内も確かめてください。",
    details: [
      {
        kind: "table",
        caption: "主な SNS の特徴",
        head: ["SNS", "向いている中身", "見ている人", "広がり方", "リンク"],
        rows: [
          ["X", "短い文、いまの話題、作っている途中の話", "話題や新しい情報を早く知りたい人", "リポスト（共有）で、フォロワーの外へ一気に広がることがある", "本文に置ける。yabumi から送るときは費用が上がる"],
          ["Instagram", "写真・動画など、見た目で伝わるもの", "好きなものを眺めたい人、お店や商品を探す人", "おすすめ（発見）と、保存・共有で広がる", "本文の URL は押せない。プロフィールのリンクに置く"],
          ["Threads", "気軽な会話、日々のつぶやき", "Instagram も使っている人が多い", "おすすめに出やすく、フォロワーが少なくても読まれることがある", "本文に置ける"],
          ["Facebook", "地域のお知らせ、少し長めの文", "地域や仕事のつながりを大事にする人", "知り合いや、ページをフォローした人のつながりで広がる", "本文に置ける"],
          ["TikTok", "縦の短い動画", "楽しいもの・新しいものを探す人", "おすすめに出ると、フォロワーがいなくても一気に見られる", "本文の URL は押せない。プロフィールのリンクに置く"],
          ["YouTube", "長めの動画、使い方の説明、ショート動画", "調べもの・楽しみの両方で見る、幅広い人", "検索とおすすめで、長く見つけてもらえる", "説明欄に置ける"],
          ["note", "長めの文章、考えや裏側の話", "じっくり読みたい人、作り手の考えに興味がある人", "note の中のおすすめや、検索から読まれる", "本文に置ける"],
        ],
      },
      {
        kind: "p",
        text: "字数や画像の数などの決まりは、投稿をつくる画面の右側（SNS ごとの見え方）にも出ます。",
      },
    ],
    related: ["proAccount", "facebookPage", "payPerUse", "hashtag"],
  },
} satisfies Record<string, GlossaryTerm>;

export type GlossaryKey = keyof typeof glossary;
export const GLOSSARY_KEYS = Object.keys(glossary) as GlossaryKey[];

// 用語集のページの分類（上の目次と見出し）。どの語もどれか 1 つに入れる（テストで確かめる）
export const GLOSSARY_CATEGORIES: { id: string; label: string; keys: GlossaryKey[] }[] = [
  { id: "goals", label: "目標と計画", keys: ["kgi", "kpi", "roadmap", "persona"] },
  { id: "flow", label: "お客さんの流れと数字", keys: ["marketingFunnel", "awareness", "impression", "conversion", "correlation"] },
  { id: "posting", label: "発信のしかた", keys: ["contentPillar", "toneAndManner", "hashtag", "buildInPublic", "ugc"] },
  { id: "media", label: "メディアと広告", keys: ["tripleMedia", "ownedMedia", "earnedMedia", "paidMedia", "organicVsAds", "seoVsSns", "ownedAudience", "newsletter"] },
  { id: "sns", label: "SNS ごと", keys: ["snsTraits", "proAccount", "facebookPage", "payPerUse"] },
  { id: "tech", label: "リンクと技術", keys: ["shortLink", "campaignLink", "storeListing", "dns", "cname", "subdomain"] },
];

export function isGlossaryKey(k: string): k is GlossaryKey {
  return Object.hasOwn(glossary, k);
}

export function termTitle(term: GlossaryTerm) {
  return term.reading ? `${term.label}（${term.reading}）` : term.label;
}

// 語の分類（用語集の詳細ページのパンくずと、前と次）
export function categoryOf(k: GlossaryKey): (typeof GLOSSARY_CATEGORIES)[number] {
  return GLOSSARY_CATEGORIES.find((c) => c.keys.includes(k))!;
}

// 同じ分類の中の前と次の語（端ではない）
export function neighbors(k: GlossaryKey): { prev: GlossaryKey | null; next: GlossaryKey | null } {
  const keys = categoryOf(k).keys;
  const i = keys.indexOf(k);
  return { prev: keys[i - 1] ?? null, next: keys[i + 1] ?? null };
}

export function glossaryHref(k: GlossaryKey): string {
  return `/glossary/${k}`;
}

// 挿絵（public/glossary/<key>.webp。scripts/glossary-illustrations.mjs で一度だけ作る。4.45）
export function illustrationSrc(k: GlossaryKey): string {
  return `/glossary/${k}.webp`;
}

export function illustrationAlt(term: GlossaryTerm): string {
  return `${term.label} のイメージのイラスト`;
}
