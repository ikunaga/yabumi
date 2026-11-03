// 作業のあとの「ひとこと」（docs/architecture.md の 4.47）。用語集（src/lib/glossary/terms.ts）とは別に置き、1 つに用語の key を 1 つ結びつける。
// 文は 2 文まで・誇張しない。説明に使う用語は用語集にあるものだけ（テストで key を確かめる）。
// 出すかどうか・どれを出すかは DB の関数 claim_learning_tip が決める（1 日 1 回まで・まだ出していないもの → 出したのが古いもの）

export const TIP_TRIGGERS = ["post_scheduled", "post_sent", "url_in_body", "instagram_selected", "analytics_opened", "plan_saved"] as const;
export type TipTrigger = (typeof TIP_TRIGGERS)[number];

export type Tip = { key: string; term: string; text: string };

export const TIPS: Record<TipTrigger, Tip[]> = {
  // 投稿を予約したあと（カレンダーに移ってきたとき）
  post_scheduled: [
    { key: "keep_going", term: "roadmap", text: "SNS は 1 本の出来より、続けた回数で届き方が変わっていきます。ロードマップで週の回数を決めておくと、続けやすくなります。" },
    { key: "count_as_kpi", term: "kpi", text: "週の投稿の回数のように、途中で追いかける小さな数字を KPI と呼びます。始めたばかりなら、まず回数を追うのがおすすめです。" },
  ],
  // 投稿を送ったあと（送信を始めた・送った・手で投稿したと記録した）
  post_sent: [
    { key: "keep_going", term: "roadmap", text: "SNS は 1 本の出来より、続けた回数で届き方が変わっていきます。ロードマップで週の回数を決めておくと、続けやすくなります。" },
    { key: "count_as_kpi", term: "kpi", text: "週の投稿の回数のように、途中で追いかける小さな数字を KPI と呼びます。始めたばかりなら、まず回数を追うのがおすすめです。" },
  ],
  // 本文に URL を入れたとき
  url_in_body: [
    { key: "use_short_link", term: "shortLink", text: "URL を短縮リンクにすると、この投稿から何人が行き先へ進んだかを数えられます。" },
    { key: "click_then_conversion", term: "conversion", text: "行き先で予約や購入まで進んでもらうことを、コンバージョンと呼びます。リンクのクリックは、その手前の数字です。" },
  ],
  // 送り先に Instagram を選んだとき
  instagram_selected: [
    { key: "instagram_links", term: "snsTraits", text: "Instagram は本文の URL を押せません。リンクはプロフィールに置き、本文では「プロフィールのリンクから」と案内するのが一般的です。" },
  ],
  // 分析を開いたとき
  analytics_opened: [
    { key: "funnel_steps", term: "marketingFunnel", text: "数字は、見られた → 押された → 行動した、の順に少なくなっていきます。どの段で大きく減っているかを見ると、直すところがわかります。" },
    { key: "impression_count", term: "impression", text: "インプレッションは、投稿が画面に出た回数です。同じ人が 2 回見れば 2 と数えるので、見た人の数より多くなります。" },
  ],
  // アカウント設計を保存したとき
  plan_saved: [
    { key: "pillars_save_time", term: "contentPillar", text: "投稿の柱を決めておくと、毎回ゼロからネタを考えずに済みます。迷ったら、柱の中から選んで書きます。" },
    { key: "persona_one_person", term: "persona", text: "届けたい相手を 1 人に絞ると（ペルソナ）、言葉選びがぶれにくくなります。広く狙うより、1 人に刺さる言葉のほうが届きます。" },
  ],
};

export function isTipTrigger(v: unknown): v is TipTrigger {
  return typeof v === "string" && (TIP_TRIGGERS as readonly string[]).includes(v);
}

export function tipByKey(key: string): Tip | null {
  for (const list of Object.values(TIPS)) {
    const t = list.find((x) => x.key === key);
    if (t) return t;
  }
  return null;
}

// 本文に URL があるか（ひとことのきっかけ。http(s):// で始まるもの）
export function hasUrl(text: string): boolean {
  return /https?:\/\/\S/.test(text);
}
