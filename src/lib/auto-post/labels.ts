import type { AutoImage, AutoKind, AutoRunReason, AutoRunStatus, AutoStopReason, TargetMode } from "./types";

// 自動の投稿の画面の言葉（画面の担当はここを使う。用語をそろえるため）

export const KIND_LABELS: Record<AutoKind, string> = {
  series: "シリーズ",
  product: "商品・サービスの紹介",
  notes: "ネタ帳のメモから",
  pillars: "テーマを順番に",
  rerun: "伸びた投稿の言い直し",
  events: "お知らせ・季節",
  commits: "開発の進み",
};

// 「確かめる」と回し方の画面の「何を」。選んだカードと同じ言い方（シリーズはフォーマットの名前で「シリーズ「連想映画クイズ」」。2026-11-20 オーナーの指摘。かっこ書きにしない〈ui-writing.md の決まり 2〉）
export function kindSummary(kind: AutoKind, formatName?: string | null): string {
  return kind === "series" && formatName ? `${KIND_LABELS.series}「${formatName}」` : KIND_LABELS[kind];
}

// 始める画面の「何を」のカードの 1 行の説明（何が起きるか）。柱は用語の説明を付けるので画面の側で組む
export const KIND_DESCRIPTIONS: Record<Exclude<AutoKind, "pillars">, string> = {
  series: "毎回 AI が新しいお題を考えます。前の回と同じお題は出しません。",
  product: "行き先（商品のページなど）へのリンクをつけて、1 つずつ紹介します。",
  notes: "書きためたメモを 1 つずつ投稿にします。",
  rerun: "よく見られた投稿を、言い方を変えてもう一度出します。",
  events: "登録したお知らせ（イベント・新商品など）を先に投稿します。なければ季節のあいさつにします。",
  commits: "アプリの開発の進み（直したこと・足したこと）を投稿にします。",
};

export const TARGET_MODE_LABELS: Record<TargetMode, string> = {
  auto: "自動で送る",
  review: "確認して送る",
  by_hand: "手で投稿",
};

export const RUN_STATUS_LABELS: Record<AutoRunStatus, string> = {
  waiting: "作る前",
  generating: "作っています",
  scheduled: "予約",
  review: "確認待ち",
  held: "下書きに回した",
  skipped: "飛ばした",
  canceled: "止めた",
};

export const RUN_REASON_TEXT: Record<AutoRunReason, string> = {
  no_material: "使える材料がありませんでした",
  cannot_write: "材料だけでは書けませんでした",
  check_failed: "送る前の確認で引っかかりました",
  similar: "前の投稿と似ています",
  made_up: "事実か確認したいところがあります",
  avoid: "アカウント設計の「やらないこと」に当たります",
  too_long: "字数の上限を超えました",
  ai_limit: "AI の今月の枠を使い切りました",
  daily_limit: "今日の自動の投稿の上限に届きました",
  disconnected: "SNS のつながりが切れています",
  error: "うまく作れませんでした",
  user_skipped: "飛ばしました",
  plan_paused: "止めました",
  operator_hold: "運営者が止めました",
  image_failed: "画像をつくれませんでした",
};

export const STOP_REASON_TEXT: Record<AutoStopReason, string> = {
  fail_streak: "2 回続けて送れませんでした",
  disconnected: "SNS のつながりが切れています",
  materials_out: "材料を使い切りました",
  operator: "運営者が止めました",
};

// 送る時刻を過ぎても確かめなかった配信先の理由（post_targets.error_message。engine.ts の EXPIRED_MESSAGE と同じ）と、短い言葉
export const EXPIRED_TARGET_LABEL = "確認できなかったので送りませんでした";

// カレンダーの自動の回の言葉（数え方: 確かめ待ちは承認するまで予約に数えない）。
// PC の週・月のマスは札の文字が 6〜8 字ほどで切れるので、札には回し方の名前・投稿の題を出し、この言葉は吹き出し・注意・読み上げ・スマホの一覧に出す
// （2026-11-16 実装担当1 と合わせた。feat/auto-post-entry）
// - before: ジョブがまだ作っていない回（点線の札）
// - awaiting: 送り先がどれも確かめ待ち（点線の札・下書きの見え方。予約に数えない。押すと確かめる画面）。
//   一部だけ確かめ待ち（Threads は送信待ち、X は確かめ待ちなど）は、予約の札に ↻ と「X は確かめ待ちです」の注意
// - scheduled: 予約（ふつうの札に ↻）
// - expired: 確かめないまま送る時刻を過ぎた（! 失敗。error_message に長い文、短くは EXPIRED_TARGET_LABEL）
export const CALENDAR_CHIP = {
  before: "↻ 自動（作る前）",
  awaiting: "↻ 確認待ち",
  scheduled: "↻",
  expired: "! 失敗",
} as const;

// 「確かめて送る」だけの SNS（DB の is_review_sns と同じ。X・TikTok・YouTube）が、なぜ自動で送れないか。
// 根拠は docs/design/auto-post.md の 4.2（X）・4.4（TikTok）・4.5（YouTube）。言い換えるときも、そこに書いた決まりの範囲を出ない
export const REVIEW_ONLY_SNS = ["x", "tiktok", "youtube"] as const;
export type ReviewOnlySns = (typeof REVIEW_ONLY_SNS)[number];

// 画面にそのまま出す 1 行（「自動で送る」が選べない理由）
export const REVIEW_REASON_SHORT: Record<ReviewOnlySns, string> = {
  x: "X の決まりで、送る前にあなたが中身を見る必要があります",
  tiktok: "TikTok の決まりで、送るたびにあなたの同意が要ります",
  youtube: "YouTube の決まりで、送るたびにあなたの同意が要ります",
};

// 「?」で開く説明（各社の決まりの中身）
export const REVIEW_REASON_DETAIL: Record<ReviewOnlySns, string> = {
  x: "X の開発者向けの決まりでは、X に投稿するサービスは、送る前に「送る中身をそのまま」あなたに見せることになっています。見ないまま AI の文を送ると、この決まりに反するおそれがあり、yabumi から X に送る仕組みごと止められると、ほかの利用者も X に送れなくなります。そこで X は、中身を見て「送る」を押したものだけ送ります。",
  tiktok: "TikTok の決まりでは、送るたびに、送る前の見た目を見せ、公開範囲（だれに見せるか）をあなたが選び、あなたがはっきり同意してから送ることになっています。決めた時刻に、人の操作なしで送ることはできません。",
  youtube: "YouTube の開発者向けの決まりでは、アップロードは 1 本ごとに、行う前にあなたがはっきり同意すること、公開する中身はあなたが最後に決めることになっています。決めた時刻に、人の操作なしで送ることはできません。",
};

// 確かめ待ちになったときの流れ（1 行）
export const REVIEW_FLOW = "送る 24 時間前に作って通知します → 押して中身を見る → 「送る」を押したものだけ、決めた時刻に送ります（押さなければ送りません）";

// 段階 A で自動の投稿の送り先に選べない SNS の理由（TikTok・YouTube。docs/design/auto-post.md の A6・2.9 の段階 C）
export const STAGE_C_SNS_SHORT = "送るたびに同意が要る SNS なので、自動の投稿ではまだ選べません（準備中）";
export const STAGE_C_SNS_DETAIL =
  "TikTok・YouTube は、どちらも決まりで、送るたびにあなたがはっきり同意してから送ることになっているので、「自動で送る」にはできません。自動の投稿では「確認して送る」（作った下書きを通知から開き、投稿の画面の同意の欄で確認して送る）にする予定ですが、どちらも画像や動画が要るので、画像を自動で添えられるようになってから選べるようにします。それまでは、投稿をつくるの画面から送ってください。";

export function isReviewOnlySns(sns: string): sns is ReviewOnlySns {
  return (REVIEW_ONLY_SNS as readonly string[]).includes(sns);
}

// 見本を直す指示のチップ（docs/design/auto-sample-image.md の 1.1。押すと指示に足す。自分で書く欄もある）
export const INSTRUCTION_PRESETS = ["もっと短く", "絵文字なし", "やわらかく", "宣伝っぽさを減らす", "ハッシュタグなし", "季節の話から入る"] as const;

// 自動の回の画像の設定の 1 行（回し方の画面の「画像」）
export function autoImageLabel(image: AutoImage | null): string {
  if (!image) return "付けない";
  const head = image.headline === "ai" ? "・見出しは AI が書く" : image.headline === "format" ? "・フォーマットの見出し" : "";
  if (image.source === "format") return `フォーマットの画像${head}`;
  const size = { auto: "送り先に合わせる", portrait: "縦 4:5", square: "正方形 1:1", landscape: "横 16:9" }[image.size];
  return `AI がつくる（${image.style === "photo" ? "写真のように" : "イラストで"}・${size}）${head}`;
}
