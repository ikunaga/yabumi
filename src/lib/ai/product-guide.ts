// 宣伝するものの種類ごとの、AI への手がかり（決定 D34、2026-11-02）。AI の指示（system）は種類によらず同じ文字列にして
// プロンプトキャッシュを効かせ、種類ごとの違い（投稿の柱の例・ネタを聞く質問・画像の型・同業者向けの言葉）は、毎回付ける
// 「いまの状況」や材料の前に productLines で入れる。種類と行動の名前は src/lib/projects/product-types.ts
import { DESIRED_ACTION_DEFS, PRODUCT_TYPE_DEFS, isAppProject, isDesiredAction, isProductType, type DesiredAction, type ProductType } from "@/lib/projects/product-types";

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

// 開発の話（コミット・更新・ストア）を材料や案に使ってよいか。アプリのときだけ（CLAUDE.md の D34）
export function usesDevTalk(type: ProductType): boolean {
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
    usesDevTalk(p.productType)
      ? "開発の話（作っている過程・更新・ストア）は、ネタや案に使ってよい"
      : "アプリではないので、開発・ストア・ダウンロードの話を前提にしない（利用者が自分から書いたときだけ使う）",
  ];
}
