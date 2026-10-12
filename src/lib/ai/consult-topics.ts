// AI と相談（F09）の入口ごとの名前と見出し。画面とサーバーの両方から読むので、サーバー専用のものを import しない。
// ほかの画面（ロードマップ・指標）から始めた相談は、その入口に合わせた見出しと「← 戻る」を出す
// （「AI と相談」のリンクを押し間違えたように見えないように。オーナーの指摘、2026-10-12）

export type ConsultTopicMeta = {
  // 相談の画面の入口のボタン（押すとそのまま最初の発言になる）
  button: string;
  // これまでの相談の一覧での名前
  listTitle: string;
  // ほかの画面から始めたときの見出し・説明・戻り先（ないものは「AI と相談」の画面の中の入口）
  entry?: { title: string; lead: string; back: { path: string; label: string } };
};

export const CONSULT_TOPIC_META = {
  what_to_post: { button: "何を投稿すればいい？", listTitle: "何を投稿すればいい？" },
  no_reaction: { button: "投稿しても反応がない", listTitle: "反応がない" },
  which_sns: { button: "どの SNS に力を入れる？", listTitle: "どの SNS に力を入れる？" },
  roadmap: {
    button: "目標とロードマップを一緒に決めたい",
    listTitle: "ロードマップづくり",
    entry: {
      title: "ロードマップを AI と作る",
      lead: "AI がアカウント設計と数字を見て、最終の目標と週ごとのやることの案を出します。選んだ案だけが、ロードマップに入ります。",
      back: { path: "roadmap", label: "ロードマップに戻る" },
    },
  },
  review: {
    button: "最近の数字を振り返りたい",
    listTitle: "振り返り",
    entry: {
      title: "AI と振り返る",
      lead: "AI が指標の数字とロードマップを読み、よかった点と次の一手を出します。",
      back: { path: "metrics", label: "指標に戻る" },
    },
  },
} as const satisfies Record<string, ConsultTopicMeta>;

export type ConsultTopicKey = keyof typeof CONSULT_TOPIC_META;

export function consultTopicMeta(topic: string | null | undefined): ConsultTopicMeta | null {
  return topic && Object.hasOwn(CONSULT_TOPIC_META, topic) ? CONSULT_TOPIC_META[topic as ConsultTopicKey] : null;
}

// 一覧に要るところだけを JSON から読んだもの（AI の返事の本文は大きいので読まない）
export type ThreadMessageDigest = { role: string; kind?: string | null; text?: string | null; topic?: string | null; title?: string | null; option?: string | null; legacy?: string | null };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

// 一覧の 1 行の名前。同じ入口の相談が並んでも見分けられるように、入口の名前に中身を添える（オーナーの指摘、2026-10-12）。
// 中身は、最後に採用した案 → 最初に書いた発言 → まだ選んでいない最後の案、の順
export function summarizeConsultThread(messages: ThreadMessageDigest[]): { topicTitle: string | null; title: string; adopted: number } {
  const user = messages.filter((m) => m.role === "user");
  const first = user[0];
  const topic = first?.kind === "start" ? (consultTopicMeta(first.topic)?.listTitle ?? "相談") : null;
  const adopts = user.filter((m) => m.kind === "adopt" && m.title);
  const firstText = user.find((m) => m.kind === "text" && m.text?.trim())?.text?.trim() ?? "";
  const lastAdopt = adopts[adopts.length - 1]?.title ?? "";
  const lastOption = [...messages].reverse().find((m) => m.role === "assistant" && (m.option || m.legacy));
  const pending = lastOption ? `${lastOption.option ?? lastOption.legacy} など（まだ選んでいない）` : "";
  const title = lastAdopt || firstText || pending || (topic ? "" : "相談");
  return { topicTitle: topic, title: clip(title.replace(/\s+/g, " "), 40), adopted: adopts.length };
}
