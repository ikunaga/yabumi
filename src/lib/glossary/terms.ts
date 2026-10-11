// 用語解説（要求 F12）。画面に出てくるマーケティング用語を、素人にもわかる言葉で説明する。
// 将来は DB（glossary_terms）へ移し、AI による追加解説とつなげる。

export type GlossaryTerm = {
  label: string;
  reading?: string;
  summary: string;
  example?: string;
};

export const glossary = {
  persona: {
    label: "ペルソナ",
    summary:
      "アプリを届けたい「たった一人の典型的なユーザー像」。年齢・職業・悩み・SNS の使い方まで具体的に決めると、投稿の言葉選びがぶれなくなります。",
    example: "例:「残業続きで家計簿が続かない 28 歳の会社員。夜 23 時ごろ X を眺めている」",
  },
  conversion: {
    label: "コンバージョン",
    summary:
      "見てもらうだけでなく、こちらが望む行動まで進んでもらうこと。矢書では「ストアページを開く」「ダウンロードする」「課金する」の 3 段階を測ります。",
  },
  conversionRate: {
    label: "コンバージョン率",
    summary: "投稿を見た人のうち、望む行動まで進んだ人の割合。",
    example: "例: 1,000 人が見て 10 人がストアを開けば 1%。",
  },
  kgi: {
    label: "KGI",
    reading: "ケージーアイ",
    summary: "最終的にたどり着きたいゴールの数字。例:「3 か月で 1,000 ダウンロード」。日々追う小さな数字は KPI と呼びます。",
  },
  kpi: {
    label: "KPI",
    reading: "ケーピーアイ",
    summary: "KGI に向かう途中で、日々追いかける小さな目標の数字。",
    example: "例:「週 5 回投稿する」「投稿経由のストア訪問を月 300 回」。",
  },
  impression: {
    label: "インプレッション",
    summary: "投稿が画面に表示された回数。同じ人が 2 回見れば 2 と数えます。",
  },
  awareness: {
    label: "認知",
    reading: "にんち",
    summary:
      "アプリの存在を知ってもらうこと。ダウンロードや課金の手前の、いちばん最初の段階です。始めたばかりのアカウントは、まず認知を広げることを目標にするのが一般的です。",
    example: "例:「家計簿アプリといえば、かけいぼ日和」と思い出してもらえる状態。",
  },
  contentPillar: {
    label: "投稿の柱",
    summary:
      "アカウントで繰り返し発信する「投稿の種類」のこと。3〜4 本決めておくと、毎回ゼロからネタを考えずに済み、見る人にも「何のアカウントか」が伝わります。柱ごとに割合も決めると、宣伝ばかりになるのを防げます。",
    example: "例:「お金のコツ 40%・開発の裏側 30%・アプリの紹介 20%・利用者の声 10%」。",
  },
  toneAndManner: {
    label: "トンマナ",
    reading: "トーン・アンド・マナー",
    summary:
      "投稿の口調や雰囲気の決まりごと。です・ます調か、絵文字を使うか、専門用語を避けるかなどを決めておくと、誰が書いても・いつ書いても同じアカウントらしさが出ます。",
    example: "例:「です・ます調。親しみやすく。絵文字は 1 投稿に 1 つまで」。",
  },
  roadmap: {
    label: "ロードマップ",
    summary:
      "最終の目標（KGI）までの道のりを、週ごとのやることに分けて並べたもの。「今週は何をすればいいか」が見えるので、迷わずに続けられます。やってみて合わなければ、いつでも直します。",
    example: "例: 目標「1 か月で 12 本投稿する」→ 1 週目「投稿の柱ごとに 1 本ずつ書く」、2 週目「反応のよかった柱でもう 1 本」。",
  },
  proAccount: {
    label: "プロアカウント",
    summary:
      "Instagram の、仕事や活動の発信に使う種類のアカウント（ビジネスとクリエイターの 2 つ）。無料で、いつでも切り替えたり戻したりできます。投稿の閲覧数などが見られるようになり、矢書のようなツールから投稿できるのはこの種類だけです。",
    example: "切り替え方: Instagram のアプリ →「設定とアクティビティ」→「アカウントの種類とツール」→「プロアカウントに切り替える」。迷ったらクリエイターを選びます。",
  },
  facebookPage: {
    label: "Facebook ページ",
    summary:
      "お店・サービス・作品などのために作る、Facebook の公開のページ。個人のプロフィールとは別のものです。矢書のようなツールから Facebook に投稿できるのはページだけで、個人のプロフィールには投稿できません。",
    example: "作り方: Facebook →「メニュー」→「ページ」→「新しいページを作成」。アプリの名前で作るのがおすすめです。",
  },
  newsletter: {
    label: "ニュースレター",
    summary:
      "登録してくれた読者に、メールで届ける定期的なお便り。SNS の投稿はおすすめの表示に左右されますが、ニュースレターは読者の受信箱に直接届きます。Substack はニュースレターを書いて届けるためのサービスです。",
    example: "例:「月に 1 回、アプリの開発の振り返りを登録者に届ける」。",
  },
  ownedAudience: {
    label: "自分で持てる読者",
    summary:
      "SNS の運営の都合（表示の仕組みの変更やアカウントの停止）に左右されずに、自分から届けられる読者のこと。ニュースレターの読者のメールアドレスが代表です。SNS のフォロワーは、SNS の側の持ち物に近いと考えます。",
  },
  payPerUse: {
    label: "X の API の費用",
    summary:
      "X は、矢書のようなツールから投稿するとき、1 本ごとにお金がかかります（使った分だけ払う方式）。本文に URL がない投稿は 1 本 $0.015（約 2 円）、URL がある投稿は 1 本 $0.20（約 30 円）。矢書全体で月の上限を決めていて、超えたら自動では送らず、手で投稿してもらいます。",
    example: "例: 月 30 本、すべて URL なしなら $0.45（約 70 円）。すべて URL ありなら $6（約 900 円）。",
  },
  buildInPublic: {
    label: "Build in Public",
    reading: "ビルド・イン・パブリック",
    summary:
      "アプリを作っている途中の様子（詰まったこと、直したこと、なぜそう作ったか）を、そのまま SNS で見せる発信のしかた。完成した宣伝より身近に感じてもらいやすく、作り手を応援してくれる人が増えると、公開したときに使ってもらうきっかけになります。",
    example: "例:「通知が 2 回届く不具合に 3 日詰まりました。原因は〇〇で、こう直しました」。",
  },
  storeListing: {
    label: "ストアページ",
    summary: "App Store や Google Play の、アプリの紹介ページ。ここからダウンロードされます。",
  },
  shortLink: {
    label: "短縮リンク",
    summary:
      "長い URL の代わりに使う、短いリンク。矢書の短縮リンクは、押されると回数を数えてから本当の行き先（ストアページなど）へ移ります。SNS ごとに別のリンクを使うと、どの SNS から何人来たかがわかります。",
    example: "例: go.yabumi.app/Ab3dE5fG を押すと、App Store のアプリのページが開く。",
  },
  campaignLink: {
    label: "キャンペーンリンク",
    summary:
      "どこから来た人かを、ストアや解析の側でも見分けられるよう、URL に印を付けたもの。App Store では pt と ct、Google Play やふつうのサイトでは utm_source などを付けます。矢書の短縮リンクは、行き先に自動で付けます。",
    example: "例: App Store Connect の「キャンペーン」で、SNS ごとのダウンロード数が見られる（数が少ないうちは出ません）。",
  },
} satisfies Record<string, GlossaryTerm>;

export type GlossaryKey = keyof typeof glossary;
export const GLOSSARY_KEYS = Object.keys(glossary) as GlossaryKey[];

export function termTitle(term: GlossaryTerm) {
  return term.reading ? `${term.label}（${term.reading}）` : term.label;
}
