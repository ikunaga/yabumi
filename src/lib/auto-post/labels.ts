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
  series: "毎回 AI が新しいお題を考えます。前の投稿と同じお題は出しません。",
  product: "商品のページのリンクを付けて、1 つずつ紹介します。",
  notes: "書きためたメモを 1 つずつ投稿にします。",
  rerun: "よく見られた投稿を、言い方を変えてもう一度出します。",
  events: "登録したお知らせ（イベント・新商品など）を先に投稿します。なければ季節のあいさつにします。",
  commits: "アプリの開発の進み（直したこと・追加したこと）を投稿にします。",
};

export const TARGET_MODE_LABELS: Record<TargetMode, string> = {
  auto: "自動で送る",
  review: "確認して送る",
  by_hand: "手動で投稿",
};

export const RUN_STATUS_LABELS: Record<AutoRunStatus, string> = {
  waiting: "これから作る",
  generating: "作っています",
  scheduled: "予約",
  review: "確認待ち",
  held: "送らずに下書きに残った",
  skipped: "飛ばした",
  canceled: "送るのをやめた",
};

export const RUN_REASON_TEXT: Record<AutoRunReason, string> = {
  no_material: "使える材料がありませんでした",
  cannot_write: "材料だけでは書けませんでした",
  check_failed: "送る前の確認で引っかかりました",
  similar: "前の投稿と似ています",
  made_up: "事実か確認したいところがあります",
  avoid: "アカウントの方針の「やらないこと」に当たります",
  too_long: "字数の上限を超えました",
  ai_limit: "AI の今月の枠を使い切りました",
  daily_limit: "今日の自動投稿の上限に届きました",
  disconnected: "SNS のつながりが切れています",
  error: "うまく作れませんでした",
  user_skipped: "飛ばしました",
  plan_paused: "止めました",
  operator_hold: "yabumi の運営が止めました",
  image_failed: "画像をつくれませんでした",
  format_changed: "フォーマットの変数が変わったので、この投稿はつくりませんでした",
};

export const STOP_REASON_TEXT: Record<AutoStopReason, string> = {
  fail_streak: "2 回続けて送れませんでした",
  disconnected: "SNS のつながりが切れています",
  materials_out: "材料を使い切りました",
  operator: "yabumi の運営が止めました",
  format_changed: "フォーマットの変数が変わりました。「編集」で、変数の決め方を選び直してください",
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
  before: "↻ 自動でつくって送る投稿",
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
export const REVIEW_FLOW = "送る 24 時間前に通知します。中身を見て「送る」を押した投稿だけ、決めた時刻に送ります。";

// 段階 A で自動の投稿の送り先に選べない SNS の理由（TikTok・YouTube。docs/design/auto-post.md の A6・2.9 の段階 C）
export const STAGE_C_SNS_SHORT = "送るたびに同意が要る SNS なので、自動投稿ではまだ選べません（準備中）";
export const STAGE_C_SNS_DETAIL =
  "TikTok・YouTube は、どちらも決まりで、送るたびにあなたがはっきり同意してから送ることになっているので、「自動で送る」にはできません。自動投稿では「確認して送る」（作った下書きを通知から開き、投稿の画面の同意の欄で確認して送る）にする予定ですが、どちらも画像や動画が要るので、画像を自動で添えられるようになってから選べるようにします。それまでは、投稿をつくるの画面から送ってください。";

export function isReviewOnlySns(sns: string): sns is ReviewOnlySns {
  return (REVIEW_ONLY_SNS as readonly string[]).includes(sns);
}

// 見本を直す指示のチップ（docs/design/auto-sample-image.md の 1.1。押すと指示に足す。自分で書く欄もある）
export const INSTRUCTION_PRESETS = ["もっと短く", "絵文字なし", "やわらかく", "宣伝っぽさを減らす", "ハッシュタグなし", "季節の話から入る"] as const;

// 自動の回の画像の設定の 1 行（回し方の画面の「画像」）
export function autoImageLabel(image: AutoImage | null): string {
  if (!image) return "画像なしで送る";
  const head = image.headline === "ai" ? "・見出しは AI が書く" : image.headline === "format" ? "・フォーマットの見出し" : "";
  if (image.source === "format") return `フォーマットの画像${head}`;
  const size = { auto: "送り先に合わせる", portrait: "縦 4:5", square: "正方形 1:1", landscape: "横 16:9" }[image.size];
  return `AI がつくる（${image.style === "photo" ? "写真のように" : "イラストで"}・${size}）${head}`;
}

// 下書きに回した回（held）の理由と、利用者がすること（ホームの帯・自動投稿の「これからの投稿」・投稿の画面。2026-11-23 オーナーの了承。
// 文は ja-copy-reviewer の指摘で書き直した）。送る前の確認の理由（reason_detail）があれば、1 文として添える
const HELD_LEAD: Partial<Record<AutoRunReason, string>> = {
  check_failed: "送る前の確認で、注意が出ました。",
  similar: "前の投稿と似ています。",
  made_up: "事実と違うかもしれない言葉があります。",
  avoid: "アカウントの方針の「やらないこと」に当たります。",
  too_long: "文が長すぎて、送れない SNS があります。",
};
const HELD_TAIL: Partial<Record<AutoRunReason, string>> = {
  made_up: "正しいか確認してから、予約してください。",
  too_long: "短く編集してから、予約してください。",
};
export function heldReasonText(reason: AutoRunReason | null | undefined, detail?: string | null): string {
  if (reason === "image_failed") return "この投稿に、画像を付けられませんでした。画像を追加してから、予約してください。画像なしでよければ、文を確認して予約してください。";
  const lead = reason ? HELD_LEAD[reason] : undefined;
  if (reason && lead) {
    const d = detail?.trim() ? `${[...detail.trim().replace(/[。.]+$/, "")].slice(0, 80).join("")}。` : "";
    return `${lead}${d}${HELD_TAIL[reason] ?? "文を編集してから、予約してください。"}`;
  }
  return "この投稿は、送る前に確認が必要です。中身を見てから、予約してください。";
}

// 回を作れなかった（reason = error）ときの、利用者向けの続きの文（2026-11-24）。reason_detail は運営者が原因を追うための文
// （例外の種類など）なので、画面にはそのまま出さない。時間内に作り終えられなかったときだけ、そのことを書く
export const TIMEOUT_DETAIL = "時間内に作り終えられませんでした。3 回試しました";
export function errorRunText(detail: string | null | undefined): string {
  // ja-copy-reviewer の指摘（2026-11-24）: この 1 本は送らないことと、利用者は何もしなくてよいこと（次はいつもどおり送る）を書く
  return detail === TIMEOUT_DETAIL
    ? "作るのに時間がかかりすぎて、作り終えられませんでした。この投稿は送っていません。次の投稿は、いつもどおり送ります。"
    : "この投稿は作れなかったので、送っていません。次の投稿は、いつもどおり送ります。";
}

