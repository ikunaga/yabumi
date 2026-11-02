// 宣伝するものの種類ごとの、AI への手がかり（決定 D34、2026-11-02）。AI の指示（system）は種類によらず同じ文字列にして
// プロンプトキャッシュを効かせ、種類ごとの違い（投稿の柱の例・ネタを聞く質問・画像の型・同業者向けの言葉）は、毎回付ける
// 「いまの状況」や材料の前に productLines で入れる。種類と行動の名前は src/lib/projects/product-types.ts
import { DESIRED_ACTION_DEFS, PRODUCT_TYPE_DEFS, isAppProject, isDevProject, isDesiredAction, isProductType, type DesiredAction, type ProductType } from "@/lib/projects/product-types";

export type IdeaQuestionDef = { question: string; choices: string[] };

export type ProductGuide = {
  // 指示の中での呼び方（「〇〇を広める」）
  noun: string;
  // 投稿の柱の例（「ネタがない」を起こさない、ふだんの仕事で自然に溜まるもの）
  pillars: string[];
  // ネタを出すの「最近のできごと」で聞く 3 つ（素人でも答えやすい例つき）
  newsQuestions: IdeaQuestionDef[];
  // 答えの欄に薄く出す例
  newsExample: string;
  // 画像の「写真に見出し」（screen）で使う写真の例
  photo: string;
  // 作り手・同業者の側の言葉の例（届けたい相手が同業者のときだけ使う）
  insiderTags: string;
};

export const PRODUCT_GUIDES: Record<ProductType, ProductGuide> = {
  app: {
    noun: "アプリ",
    pillars: ["詰まった・直したこと", "なぜそう作ったか", "アプリの小さな更新", "使い方のコツ", "使っている人の声"],
    newsQuestions: [
      { question: "この 1〜2 週間で、アプリについてやったこと・変えたことは？", choices: ["新しい機能を足した", "不具合を直した", "見た目や文言を整えた", "ストアの準備をした"] },
      { question: "うまくいかなかったこと、迷ったこと、時間がかかったことは？", choices: ["思ったより作るのが大変だった", "どちらの作り方にするか迷った", "審査や設定でつまずいた"] },
      { question: "使ってくれた人の声や、自分で使ってみて気づいたことは？", choices: ["感想や要望をもらった", "自分で毎日使っている", "まだ誰にも使われていない"] },
    ],
    newsExample: "例: 通知が 2 回届く不具合を直した。原因は時差の計算だった",
    photo: "アプリの画面",
    insiderTags: "#個人開発 #indiedev",
  },
  web_service: {
    noun: "サービス",
    pillars: ["使う人の困りごとと解決のしかた", "小さな改善・お知らせ", "使い方のコツ", "なぜ作ったか・考え", "使っている人の声"],
    newsQuestions: [
      { question: "この 1〜2 週間で、サービスについてやったこと・変えたことは？", choices: ["新しい機能を足した", "使いにくいところを直した", "料金や案内を見直した", "お知らせを出した"] },
      { question: "使う人から聞いた困りごとや、よくある質問は？", choices: ["使い方を聞かれた", "要望をもらった", "解約や離れた理由を聞いた"] },
      { question: "うまくいったこと、迷ったこと、気づいたことは？", choices: ["登録が増えた", "どちらにするか迷った", "数字を見て気づいたことがある"] },
    ],
    newsExample: "例: 予約の画面で迷う人が多かったので、ボタンの文言を変えた",
    photo: "サービスの画面",
    insiderTags: "#個人開発 #SaaS",
  },
  shop: {
    noun: "お店",
    pillars: ["仕込み・準備のようす", "季節のおすすめ・新しいもの", "お客さんの声", "店の裏側・人", "来る前に知っておくと便利なこと"],
    newsQuestions: [
      { question: "この 1〜2 週間で、お店で新しく出したもの・変えたことは？", choices: ["季節のメニュー・商品を出した", "営業時間や席を変えた", "店内を少し変えた", "イベントを決めた"] },
      { question: "お客さんに言われたこと、うれしかったことは？", choices: ["おいしい・よかったと言われた", "よく聞かれることがある", "常連さんとの話"] },
      { question: "仕込みや準備で、こだわっていること・手間をかけたことは？", choices: ["材料や仕入れ", "時間のかかる作業", "見えないところの準備"] },
    ],
    newsExample: "例: 秋のケーキを 2 種類出した。栗は近くの農家さんから",
    photo: "お店・料理・商品の写真",
    insiderTags: "#飲食店経営 #個人店経営",
  },
  online_shop: {
    noun: "商品",
    pillars: ["作る過程・材料", "使い方・合わせ方", "届いた人の声", "新しい商品・再入荷", "作り手の考え・暮らし"],
    newsQuestions: [
      { question: "この 1〜2 週間で、作ったもの・新しく出したものは？", choices: ["新しい商品を作った", "再入荷した", "色や形を増やした", "セールや送料を変えた"] },
      { question: "作るときに迷ったこと、こだわったこと、手間をかけたことは？", choices: ["材料選び", "形や色", "梱包や届け方"] },
      { question: "買ってくれた人・見てくれた人から言われたことは？", choices: ["届いた感想をもらった", "よく聞かれることがある", "まだ感想はない"] },
    ],
    newsExample: "例: 冬向けのマフラーを 3 色作った。毛糸選びに 1 週間かかった",
    photo: "商品の写真",
    insiderTags: "#ハンドメイド作家 #ネットショップ運営",
  },
  service: {
    noun: "サービス",
    pillars: ["お客さん・生徒の変化", "よくある質問への答え", "先生・担当者の考え", "当日のようす・裏側", "予約・申し込みの案内"],
    newsQuestions: [
      { question: "この 1〜2 週間で、お客さん・生徒さんとのことで印象に残ったことは？", choices: ["できるようになったことがあった", "うれしい感想をもらった", "はじめての人が来た"] },
      { question: "よく聞かれること、最初に不安に思われることは？", choices: ["料金や時間", "はじめてでも大丈夫か", "どんな準備がいるか"] },
      { question: "仕事のやり方で、こだわっていること・変えたことは？", choices: ["進め方を変えた", "新しいメニューを作った", "道具や場所を変えた"] },
    ],
    newsExample: "例: 3 か月通っている生徒さんが、はじめて前屈で床に手がついた",
    photo: "教室・施術・仕事のようすの写真",
    insiderTags: "#フリーランス #個人事業主",
  },
  creator: {
    noun: "作品・発信",
    pillars: ["制作の過程", "作品に込めた考え", "見てくれた人の反応", "新作・更新のお知らせ", "道具・好きなもの"],
    newsQuestions: [
      { question: "この 1〜2 週間で、作ったもの・出したものは？", choices: ["新しい作品を出した", "途中のものがある", "更新・配信をした"] },
      { question: "作るときに迷ったこと、こだわったこと、時間がかかったことは？", choices: ["構図や表現", "道具や方法", "締め切りやペース"] },
      { question: "見てくれた人の反応や、自分で気づいたことは？", choices: ["感想をもらった", "思ったより見られた", "まだ反応は少ない"] },
    ],
    newsExample: "例: 新しいイラストを描いた。夕方の光の色を出すのに迷った",
    photo: "作品の写真",
    insiderTags: "#絵描きさんと繋がりたい #創作",
  },
  other: {
    noun: "商品・サービス",
    pillars: ["取り組みの過程", "考えていること", "関わった人の声", "お知らせ", "よくある質問への答え"],
    newsQuestions: [
      { question: "この 1〜2 週間で、やったこと・新しく決めたことは？", choices: ["新しいことを始めた", "準備を進めた", "お知らせを出した"] },
      { question: "うまくいかなかったこと、迷ったこと、時間がかかったことは？", choices: ["思ったより大変だった", "どちらにするか迷った", "手続きでつまずいた"] },
      { question: "関わった人の声や、自分で気づいたことは？", choices: ["感想をもらった", "よく聞かれることがある", "まだ反応はない"] },
    ],
    newsExample: "例: 来月のイベントの会場が決まった",
    photo: "写真",
    insiderTags: "#同業者 の言葉",
  },
};

// 種類と行動を読む（前の版のプロジェクトは種類がないので、アプリとして扱う。isAppProject と同じ）
export function productTypeOf(raw: unknown): ProductType {
  return isProductType(raw) ? raw : "app";
}

export function desiredActionOf(raw: unknown): DesiredAction | null {
  return isDesiredAction(raw) ? raw : null;
}

export function guideFor(type: ProductType): ProductGuide {
  return PRODUCT_GUIDES[type];
}

// 開発の話（コミット・更新）を材料や案に使ってよいか。開発しているもの（アプリ・Web のサービス）のとき（isDevProject）
export function usesDevTalk(type: ProductType): boolean {
  return isDevProject({ product_type: type });
}

// ストアの話（App Store・Google Play・ダウンロード）を使ってよいか。アプリのときだけ（isAppProject）
export function usesStoreTalk(type: ProductType): boolean {
  return isAppProject({ product_type: type });
}

// 「いまの状況」や材料の前に付ける、宣伝するものの説明（種類・してほしいこと・種類ごとの手がかり）
export function productLines(p: { productType: ProductType; desiredAction: DesiredAction | null }): string[] {
  const def = PRODUCT_TYPE_DEFS[p.productType];
  const g = PRODUCT_GUIDES[p.productType];
  const action = p.desiredAction ? DESIRED_ACTION_DEFS[p.desiredAction] : null;
  return [
    `宣伝するものの種類: ${def.label}（${p.productType}。${def.description}）`,
    `見た人にしてほしいこと: ${action ? `${action.label}（${p.desiredAction}。${action.description}）` : "まだ決めていない"}`,
    `この種類の投稿の柱の例: ${g.pillars.join("／")}`,
    `画像に使う写真の例: ${g.photo}`,
    `同業者・作り手の側の言葉の例（届けたい相手が同業者のときだけ使う）: ${g.insiderTags}`,
    usesStoreTalk(p.productType)
      ? "開発の話（作っている過程・更新・ストア）は、ネタや案に使ってよい"
      : usesDevTalk(p.productType)
        ? "開発の話（作っている過程・更新）はネタや案に使ってよい。アプリではないので、ストア・ダウンロードの話は前提にしない"
        : "アプリではないので、開発・ストア・ダウンロードの話を前提にしない（利用者が自分から書いたときだけ使う）",
  ];
}

// アカウント設計の画面の記入例（種類ごと。欄に薄く出す例）。AI には渡さない（画面だけ）
export type PlanExamples = {
  who: string;
  pain: string;
  where: string;
  ownershipReason: string;
  pillars: { name: string; share: string; example: string }[];
  tone: string;
  avoid: string;
  hashtag: { tag: string; why: string; when: string };
  frequency: string;
  roles: Record<"x" | "threads" | "instagram" | "facebook" | "tiktok" | "youtube" | "note" | "substack", string>;
  profile: { displayName: string; handle: string; handleBackups: string; bio: string; link: string };
};

export const PLAN_EXAMPLES: Record<ProductType, PlanExamples> = {
  app: {
    who: "家計簿を何度も始めては続かなかった、28 歳の会社員",
    pain: "毎月お金が残らないが、何に使ったのかわからない",
    where: "平日の夜 23 時ごろ、布団の中で X と Threads を眺めている",
    ownershipReason: "作っている様子と一緒に出したいので、個人のアカウントにする",
    pillars: [
      { name: "詰まった・直したこと", share: "40", example: "レシートの読み取りが遅かったので、画像を小さくしてから送るようにした" },
      { name: "なぜそう作ったか", share: "30", example: "入力の手間を減らしたくて、撮るだけにした理由" },
      { name: "アプリの小さな更新", share: "20", example: "ダークモードに対応しました" },
      { name: "使っている人の声", share: "10", example: "3 か月続いたという感想を紹介" },
    ],
    tone: "です・ます調。親しみやすく、専門用語は使わない。絵文字は 1 投稿に 1 つまで",
    avoid: "ほかのアプリを悪く言わない。宣伝だけの投稿を続けない。政治の話はしない",
    hashtag: { tag: "家計簿", why: "家計簿を探している人や続けている人が見ている。人が多すぎず、話題がはっきりしている", when: "「なぜそう作ったか」「使っている人の声」の柱のとき" },
    frequency: "週 3 回（月・水・金の 21 時）",
    roles: {
      x: "作っている裏側と小さな更新を短く",
      threads: "X と同じ内容を、少し丁寧な言葉で",
      instagram: "アプリの画面で、使い方のコツを見せる",
      facebook: "当面は使わない",
      tiktok: "30 秒で使い方を見せる画面の動画",
      youtube: "当面は使わない",
      note: "月に 1 本、作った理由や振り返りを長文で（手で投稿）",
      substack: "使ってくれている人に、更新のお知らせをメールで（手で投稿）",
    },
    profile: { displayName: "まさ｜家計簿アプリ「かけいぼ日和」を作っています", handle: "kakeibo_biyori", handleBackups: "kakeibo_biyori_app\nkakeibobiyori\nmasa_kakeibo", bio: "家計簿が続かない人のためのアプリ「かけいぼ日和」をひとりで開発中。お金が貯まる小さなコツと、作っている裏側を発信します。", link: "App Store のページの URL" },
  },
  web_service: {
    who: "ひとりで美容室を営む、予約の電話に追われている 40 代の店主",
    pain: "施術中に電話が鳴り、予約の取りこぼしがある",
    where: "お昼休みと閉店後に、Instagram と X を見ている",
    ownershipReason: "サービスの名前で探されることが多いので、専用のアカウントにする",
    pillars: [
      { name: "使う人の困りごとと解決のしかた", share: "40", example: "電話の予約を減らすための 3 つの設定" },
      { name: "使い方のコツ", share: "25", example: "キャンセル待ちを自動で案内する方法" },
      { name: "小さな改善・お知らせ", share: "20", example: "予約の画面が少し速くなりました" },
      { name: "使っている人の声", share: "15", example: "電話が半分になったお店の話" },
    ],
    tone: "です・ます調。業界の言葉は使わず、店主の目線で",
    avoid: "ほかのサービスを悪く言わない。数字は確かめたものだけを書く",
    hashtag: { tag: "美容室経営", why: "お店を営んでいる人が見ている。届けたい相手と同じ立場の人が多い", when: "「使う人の困りごと」の柱のとき" },
    frequency: "週 3 回（火・木・土の 12 時）",
    roles: {
      x: "小さな改善と、店主の困りごとへの答えを短く",
      threads: "X と同じ内容を、少し丁寧な言葉で",
      instagram: "画面の写真で、使い方を見せる",
      facebook: "お店の人が集まるグループに向けて、月に数回",
      tiktok: "当面は使わない",
      youtube: "使い方の動画を、月に 1 本",
      note: "導入したお店の話を長文で（手で投稿）",
      substack: "使っている人に、新しい機能をメールで（手で投稿）",
    },
    profile: { displayName: "よやくのおと｜小さなお店の予約サービス", handle: "yoyaku_note", handleBackups: "yoyakunote\nyoyaku_note_jp", bio: "ひとりで営むお店のための予約サービス「よやくのおと」。電話の予約を減らすコツと、使い方を発信します。", link: "サービスの紹介ページの URL" },
  },
  shop: {
    who: "朝の通勤前にパンを買いたい、駅を使う 30 代の会社員",
    pain: "朝は急いでいて、どこのパン屋が開いているかわからない",
    where: "通勤の電車の中で、朝 7 時ごろに Instagram を見ている",
    ownershipReason: "お店の名前で探されるので、お店のアカウントにする",
    pillars: [
      { name: "季節のおすすめ・新しいもの", share: "40", example: "今週から栗のデニッシュが並びます" },
      { name: "仕込み・準備のようす", share: "30", example: "朝 4 時から生地を伸ばしているところ" },
      { name: "お客さんの声", share: "15", example: "贈り物にしてくれた方の感想を紹介" },
      { name: "来る前に知っておくと便利なこと", share: "15", example: "焼き上がりの時間と、売り切れやすいパン" },
    ],
    tone: "です・ます調。あたたかく、短く。絵文字は 1 投稿に 1 つまで",
    avoid: "ほかのお店を悪く言わない。宣伝だけの投稿を続けない。政治の話はしない",
    hashtag: { tag: "パン屋巡り", why: "近くのパン屋を探している人が見ている。人が多すぎず、話題がはっきりしている", when: "「季節のおすすめ」の柱のとき" },
    frequency: "週 3 回（月・水・金の朝 7 時）",
    roles: {
      x: "その日に焼いたものと、売り切れのお知らせを短く",
      threads: "X と同じ内容を、少し丁寧な言葉で",
      instagram: "パンの写真で、季節の新作を見せる",
      facebook: "当面は使わない",
      tiktok: "30 秒で焼き上がりまでを見せる動画",
      youtube: "当面は使わない",
      note: "月に 1 本、お店の振り返りを長文で（手で投稿）",
      substack: "常連さんに、新作と営業日の予定をメールで（手で投稿）",
    },
    profile: { displayName: "こむぎ日和｜駅前の小さなパン屋", handle: "komugi_biyori", handleBackups: "komugibiyori\nkomugi_biyori_bakery", bio: "駅前の小さなパン屋「こむぎ日和」。朝 7 時に焼き上がる食パンと、季節のパンのお知らせをしています。火曜定休。", link: "お店の地図か予約のページの URL" },
  },
  online_shop: {
    who: "長く使える布小物を探している、30 代で子育て中の人",
    pain: "安いものはすぐ傷み、どれが長く使えるかわからない",
    where: "子どもが寝たあとの夜 22 時ごろ、Instagram と Threads を見ている",
    ownershipReason: "作品と一緒に作り手の顔も出したいので、個人のアカウントにする",
    pillars: [
      { name: "作る過程・材料", share: "35", example: "リネンを 3 回水通ししてから裁断する理由" },
      { name: "使い方・合わせ方", share: "25", example: "エコバッグを小さくたたむコツ" },
      { name: "届いた人の声", share: "20", example: "1 年使ってくれた方の写真を紹介" },
      { name: "新しい商品・再入荷", share: "20", example: "からし色のポーチが再入荷しました" },
    ],
    tone: "です・ます調。ていねいに、短く。商品の説明は具体的に",
    avoid: "ほかの作家さんの作品と比べない。在庫や納期は確かめてから書く",
    hashtag: { tag: "リネン雑貨", why: "布の雑貨が好きな人が見ている。作家さんと買う人の両方がいる", when: "「作る過程」「新しい商品」の柱のとき" },
    frequency: "週 3 回（火・木・日の 21 時）",
    roles: {
      x: "再入荷とお知らせを短く",
      threads: "作る過程を、話しかけるように",
      instagram: "商品の写真で、使い方と色を見せる",
      facebook: "当面は使わない",
      tiktok: "縫っているところを 30 秒で見せる動画",
      youtube: "当面は使わない",
      note: "月に 1 本、作り手の考えを長文で（手で投稿）",
      substack: "買ってくれた人に、新作の予定をメールで（手で投稿）",
    },
    profile: { displayName: "ぬのとこ｜リネンの布小物", handle: "nunotoko", handleBackups: "nunotoko_linen\nnuno_toko", bio: "リネンの布小物を、ひとつずつ縫っています。作る過程と、新作・再入荷のお知らせを発信します。", link: "ネットのお店（BASE・minne など）の URL" },
  },
  service: {
    who: "体のかたさが気になる、デスクワークの 40 代の会社員",
    pain: "ヨガに興味はあるが、体がかたくて行きにくい",
    where: "昼休みと寝る前に、Instagram と X を見ている",
    ownershipReason: "先生の人柄で選ばれることが多いので、個人のアカウントにする",
    pillars: [
      { name: "お客さん・生徒の変化", share: "30", example: "3 か月通った生徒さんが、前屈で床に手がついた" },
      { name: "よくある質問への答え", share: "30", example: "体がかたくても大丈夫？への答え" },
      { name: "先生・担当者の考え", share: "20", example: "無理に伸ばさない理由" },
      { name: "予約・申し込みの案内", share: "20", example: "来月の体験クラスの空き" },
    ],
    tone: "です・ます調。やさしく、はじめての人に話しかけるように",
    avoid: "効き目を言い切らない（「必ず治る」など）。ほかの教室を悪く言わない",
    hashtag: { tag: "大人のヨガ", why: "これからヨガを始めたい大人が見ている。人が多すぎず、届けたい相手に近い", when: "「よくある質問への答え」の柱のとき" },
    frequency: "週 3 回（月・水・土の 12 時）",
    roles: {
      x: "よくある質問への答えを短く",
      threads: "生徒さんの変化を、話しかけるように",
      instagram: "教室のようすの写真と、体験の案内",
      facebook: "近所の人向けに、教室のお知らせ",
      tiktok: "1 分でできるストレッチの動画",
      youtube: "当面は使わない",
      note: "月に 1 本、先生の考えを長文で（手で投稿）",
      substack: "生徒さんに、来月の予定をメールで（手で投稿）",
    },
    profile: { displayName: "ゆう｜体がかたい人のためのヨガ教室", handle: "yu_yoga_studio", handleBackups: "yuyoga_studio\nyu_yoga_class", bio: "体がかたい大人のためのヨガ教室をしています。よくある質問への答えと、体験クラスのご案内をしています。", link: "予約のページの URL" },
  },
  creator: {
    who: "夕方の空や街の風景が好きな、20 代の会社員",
    pain: "SNS で流れてくる絵は多いが、心に残るものに出会えない",
    where: "帰りの電車の中で、X と Instagram を見ている",
    ownershipReason: "作品と考えを一緒に届けたいので、作家名の個人のアカウントにする",
    pillars: [
      { name: "制作の過程", share: "35", example: "下書きから色を塗るまでを 4 枚で" },
      { name: "新作・更新のお知らせ", share: "30", example: "新しいイラストを描きました" },
      { name: "作品に込めた考え", share: "20", example: "夕方の光の色を選んだ理由" },
      { name: "見てくれた人の反応", share: "15", example: "展示で言われてうれしかったこと" },
    ],
    tone: "です・ます調。静かに、短く。作品を説明しすぎない",
    avoid: "ほかの作家さんと比べない。依頼の値段は確かめてから書く",
    hashtag: { tag: "夕焼けイラスト", why: "夕焼けの絵が好きな人が見ている。話題がはっきりしていて、見つけてもらいやすい", when: "「新作」の柱のとき" },
    frequency: "週 2 回（水・日の 20 時）",
    roles: {
      x: "新作と制作の過程を短く",
      threads: "作品に込めた考えを、話しかけるように",
      instagram: "完成した作品を大きく見せる",
      facebook: "当面は使わない",
      tiktok: "描いているところを 30 秒の動画で",
      youtube: "当面は使わない",
      note: "月に 1 本、制作の振り返りを長文で（手で投稿）",
      substack: "見てくれている人に、展示や販売の予定をメールで（手で投稿）",
    },
    profile: { displayName: "ひより｜夕方の風景を描いています", handle: "hiyori_draws", handleBackups: "hiyoridraws\nhiyori_art", bio: "夕方の空と街の風景を描いています。新作と、描いている過程を発信しています。お仕事のご相談は DM で。", link: "作品のページの URL" },
  },
  other: {
    who: "地域のことに関わりたいが、きっかけがない 30 代の人",
    pain: "どんな活動があるのか、どう参加すればいいかわからない",
    where: "週末の朝に、Instagram と Facebook を見ている",
    ownershipReason: "活動の名前で探されるので、専用のアカウントにする",
    pillars: [
      { name: "取り組みの過程", share: "35", example: "次のイベントの準備をしているところ" },
      { name: "お知らせ", share: "30", example: "来月のイベントの日程" },
      { name: "関わった人の声", share: "20", example: "参加した人の感想を紹介" },
      { name: "よくある質問への答え", share: "15", example: "はじめてでも参加できる？への答え" },
    ],
    tone: "です・ます調。やさしく、はじめての人に話しかけるように",
    avoid: "ほかの団体を悪く言わない。参加した人の顔は許可を得てから出す",
    hashtag: { tag: "地域イベント", why: "近くのイベントを探している人が見ている。地名と合わせると届きやすい", when: "「お知らせ」の柱のとき" },
    frequency: "週 2 回（水・土の朝 9 時）",
    roles: {
      x: "お知らせを短く",
      threads: "取り組みの過程を、話しかけるように",
      instagram: "活動のようすの写真",
      facebook: "地域の人に向けて、イベントの案内",
      tiktok: "当面は使わない",
      youtube: "当面は使わない",
      note: "月に 1 本、活動の振り返りを長文で（手で投稿）",
      substack: "参加した人に、次の予定をメールで（手で投稿）",
    },
    profile: { displayName: "まちのわ｜地域の小さなイベント", handle: "machinowa", handleBackups: "machi_no_wa\nmachinowa_event", bio: "地域の小さなイベントを開いています。次の予定と、準備のようすを発信しています。", link: "イベントの案内のページの URL" },
  },
};
