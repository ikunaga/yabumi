// 投稿の文を書く AI に共通の「日本語の書き方の決まり」と、書いたあとに機械で見つける確かめ（docs/architecture.md の 4.55）。
// 決まりは指示（system。固定の文）に入れる共通の下地。その人ごとの書き方（文調のメモ・例の投稿。実装担当2 の src/lib/plan/voice.ts）は
// 利用者のメッセージの「# この人の書き方」に入り、語尾・絵文字・記号・改行の細部はそちらを先にする（2026-11-09 にすり合わせた）。
// 確かめ（styleProblems）は正規表現で数えるだけで、費用は 0。引っかかった下書きだけを AI に 1 回直させる（shorten.ts）

export const VOICE_HEADING = "# この人の書き方";

export const JAPANESE_STYLE_RULES = `# 日本語の書き方（どの投稿にも共通）
人が自分の言葉で書いたような日本語にする。SNS でよく見る「AI が書いたような文」の型を避ける。
- 優先の順: 書いていないことを足さない・誇張しない・決まりきった型を使わない、はどの書き方でも守る。語尾・絵文字・記号・改行などの細部は、SNS ごとの口調 → 利用者のメッセージの「${VOICE_HEADING}」 → この決まり、の順に先にする（「${VOICE_HEADING}」がなければ、口調とこの決まりに従う）
- 文末は「です・ます」か「だ・である」のどちらかにそろえる。同じ語尾（「〜です。〜です。〜です。」）を 3 つ続けない。言い切る文と「〜ました」「〜ています」を混ぜて、話すときの流れにする
- 体言止め（「こだわりの一杯。」「金曜だけの新作。」）は続けない。1 投稿に 1 回まで
- 文の終わりには「。」を付けてそろえる（ハッシュタグの行と「」で終わる文は除く）。「。」のある文とない文を混ぜない
- 利用者が書き換える【】の印は、できるだけ文の一部として入れる（「書き上げたときは【その子の様子】でした。」）。1 文まるごとを書いてもらうときは、【】の後ろに「。」を付けない
- 「！」と「？」は、合わせて 1 投稿に 1 つまで。「〜ですよね！」「〜しませんか？」「〜でしょうか？」のように読む人へ呼びかける形は、元の文がそうなっているか、問いかけを頼まれたときだけ
- 絵文字と飾りの記号（✨ 👉 ✅ 💡 🔥 ‼️ ⭐ など）は、口調か「${VOICE_HEADING}」で決まっているときだけ使い、決まっていても 1 投稿に 2 つまで。文ごとに付けない
- 決まりきった型を使わない: 「〜な方必見」「〜な人へ」で始める、「実は」「なんと」で引っぱる、「ポイントは 3 つ」「〜の秘訣」、「いかがでしたか」「〜してみた結果…！」「皆さん、こんにちは」、締めの「ぜひ〜してみてください！」、「ワクワクが止まらない」「間違いなし」
- 読む人は 1 人の相手として書く。「皆さん」「私たちは」を主語に並べない。主語は日本語として要るときだけ書く
- カタカナ語や英語の直訳のような言い回し（「〜をシェアします」「〜をアップデートしました」「エモい体験」）は、届けたい相手がふだん使う言葉に言い換える
- 改行は話の区切り（段落）だけに使い、長い投稿で 1 文ごとに改行しない。段落の間の空行は 1 つまで。X の短い投稿は 3 行まで（1 文ずつ分けてもよい）
- 箇条書き（「・」「①」「- 」で始まる行）を並べない。要るときは文でつなぐ
- 読点は読みやすさに要るところだけに打つ（1 文に 3 つまで）。見出し・キャッチコピー・画像の文字の見出しには読点（、）を入れない
- 投稿の本文では「顧客」と書かない（来てくれた方・買ってくれた方・使ってくれている方など、読む人に向けた呼び方にする）`;

// 見出し・キャッチコピー（画像の文字）の決まり（2026-11-02 オーナーの指摘「キャッチコピーに読点を入れない」）
export const HEADLINE_RULE = "見出し・キャッチコピー・ラベル・図解のタイトルには読点（、）を入れない（区切りたいときは言葉を短くするか、2 つに分ける）";

export type StyleProblemKey =
  | "marks"
  | "calling"
  | "deco"
  | "cliche"
  | "katakana"
  | "same_ending"
  | "noun_ending"
  | "period_mix"
  | "line_breaks"
  | "bullets"
  | "commas"
  | "customer";

// key: 種類、label: 画面と AI への直しの指示に出す短い文（何が・何回）
export type StyleProblem = { key: StyleProblemKey; label: string };

export type StyleOptions = {
  sns?: string;
  // 本人の文（整える元の文・例の投稿）。ここにも同じ言い回しがあれば、本人の書き方なので指摘しない
  allow?: string[];
  // 問いかけを頼まれたとき（整え方の「問いかけて反応をもらう」）は、「？」と呼びかけを 1 つまで許す
  question?: boolean;
  // 絵文字を使ってよいとき（口調・整え方で決まったとき）。使ってよくても 3 つからは指摘する
  emoji?: boolean;
};

// 決まりきった型（label は画面に出す言い回し）
const CLICHES: { re: RegExp; label: string }[] = [
  { re: /必見/, label: "「必見」" },
  { re: /(^|\n)[^\n。]{1,20}(な|の)(方|人)へ[。！!\s]*(\n|$)/, label: "「〜な人へ」の書き出し" },
  { re: /(^|\n)実は[、,]?/, label: "「実は」の書き出し" },
  { re: /(^|\n|[。！？])なんと[、,]?/, label: "「なんと」" },
  { re: /ポイントは[0-9０-９一二三四五]+つ/, label: "「ポイントは〇つ」" },
  { re: /秘訣/, label: "「秘訣」" },
  { re: /いかがでしたか/, label: "「いかがでしたか」" },
  { re: /してみた結果/, label: "「〜してみた結果」" },
  { re: /(皆さん|みなさん)[、,]?こんにちは/, label: "「皆さん、こんにちは」" },
  { re: /ぜひ[^。\n]{0,24}(ください|ね)[！!]/, label: "「ぜひ〜ください！」" },
  { re: /が止まらない/, label: "「〜が止まらない」" },
  { re: /間違いなし/, label: "「間違いなし」" },
];

const KATAKANA = /(シェアします|シェアさせて|アップデートしました|エモい|ワクワク|マストアイテム|ゲットして)/;

// 飾りの記号（「▶︎」はプロフィールのリンクの 1 行で yabumi が使うので数えない）
const DECO = /(✨|👉|✅|💡|🔥|‼️?|⭐️?|🌟|💪|🙌|🎉|📣|🚀|💯|❗️?|❣️?|🔔)/gu;
const EMOJI = /\p{Extended_Pictographic}/gu;

// ハッシュタグだけの行
const isTagLine = (line: string) => /^([#＃][^\s#＃]+\s*)+$/u.test(line.trim());
const isProfileLine = (line: string) => line.trim().startsWith("▶");

// 本文の行（ハッシュタグだけの行と、プロフィールのリンクの 1 行を除く）
function textLines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim() && !isTagLine(l) && !isProfileLine(l));
}

// 文に分ける（「。」「！」「？」と改行で）。文末の記号・絵文字・空白は落とした中身と、終わり方を返す
function sentences(text: string): { body: string; end: string }[] {
  const out: { body: string; end: string }[] = [];
  for (const line of textLines(text)) {
    const re = /[^。！？!?]+([。！？!?]+|$)/g;
    for (const m of line.matchAll(re)) {
      const raw = m[0].trim();
      if (!raw) continue;
      const end = m[1] ?? "";
      const body = raw.slice(0, raw.length - end.length).replace(EMOJI, "").replace(/[\s‍️]+$/u, "").trim();
      if (body) out.push({ body, end });
    }
  }
  return out;
}

// 語尾（最後の 2 字。「ます」「です」「した」など）
const ending = (body: string) => body.slice(-2);
// 体言止め: 漢字かカタカナで終わる文（「」や）で終わる文、【】の印は除く）
const nounEnding = (body: string) => /[\p{Script=Han}\p{Script=Katakana}ー]$/u.test(body) && !/[」』）)】]$/.test(body);

function count(text: string, re: RegExp): number {
  return [...text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].length;
}

// 1 つの文で確かめる。見つかったものを key ごとに返す（allow と比べるため、cliche と katakana は言い回しごとに分ける）
function detect(text: string, opts: StyleOptions): Map<string, StyleProblem> {
  const found = new Map<string, StyleProblem>();
  const add = (id: string, key: StyleProblemKey, label: string) => found.set(id, { key, label });
  const body = textLines(text).join("\n");

  const marks = count(body, /[！!？?]/);
  if (marks > (opts.question ? 2 : 1)) add("marks", "marks", `「！」「？」が ${marks} つあります（合わせて 1 つまで）`);
  const calling = count(body, /(ですよね|ますよね|ませんか|でしょうか)[！!？?]/);
  if (calling > (opts.question ? 1 : 0)) add("calling", "calling", `「〜ですよね！」「〜しませんか？」のような呼びかけが ${calling} 回あります`);

  const deco = count(body, DECO);
  const emoji = count(body, EMOJI);
  if (opts.emoji ? emoji > 2 : deco > 0) add("deco", "deco", opts.emoji ? `絵文字が ${emoji} つあります（2 つまで）` : `飾りの記号（✨・👉 など）が ${deco} つあります`);

  for (const c of CLICHES) if (c.re.test(body)) add(`cliche:${c.label}`, "cliche", `決まりきった型 ${c.label}`);
  const k = body.match(KATAKANA);
  if (k) add(`katakana:${k[1]}`, "katakana", `カタカナ語・直訳の言い回し「${k[1]}」`);

  const ss = sentences(text);
  for (let i = 2; i < ss.length; i++) {
    const e = ending(ss[i].body);
    if (e.length === 2 && e === ending(ss[i - 1].body) && e === ending(ss[i - 2].body)) {
      add("same_ending", "same_ending", `同じ語尾「〜${e}」が 3 つ続いています`);
      break;
    }
  }
  const nouns = ss.filter((s) => nounEnding(s.body)).length;
  if (nouns >= 2) add("noun_ending", "noun_ending", `体言止めが ${nouns} 回あります（1 回まで）`);

  // 「。」のある文とない文が混ざる（行の終わりで数える。「！」「？」・」で終わる行は除く）
  const lineEnds = textLines(text).map((l) => l.replace(EMOJI, "").replace(/[\s‍️]+$/u, "").trim());
  const withPeriod = lineEnds.filter((l) => /。$/.test(l)).length;
  const bare = lineEnds.filter((l) => l && !/[。！？!?」』）)】…]$/.test(l)).length;
  if (withPeriod > 0 && bare > 0) add("period_mix", "period_mix", "文の終わりの「。」が、ある文とない文で混ざっています");

  // X は 3 行に分けるくらいなら人もふつうにするので、4 行からにする（2026-11-09 PM の指摘）。
  // ほかの SNS は段落に分けるのがふつうなので、5 行以上で、ほとんどの行が 1 文だけ（1 文ごとの改行）のときだけ
  const ls = textLines(text);
  const oneSentence = ls.filter((l) => sentences(l).length <= 1).length;
  const tooMany = opts.sns === "x" ? ls.length > 3 : ls.length > 4 && oneSentence / ls.length >= 0.8;
  if (tooMany) add("line_breaks", "line_breaks", opts.sns === "x" ? `改行が多めです（${ls.length} 行。X は 3 行まで）` : `1 文ごとに改行しています（${ls.length} 行。話の区切りだけで改行する）`);
  const bullets = textLines(text).filter((l) => /^\s*([・•●■□◆▪\-–]|[①-⑩]|\d+[.．)）])/.test(l)).length;
  if (bullets >= 2) add("bullets", "bullets", `箇条書きが ${bullets} 行あります`);

  const commas = ss.filter((s) => count(s.body, /[、，]/) > 3).length;
  if (commas > 0) add("commas", "commas", "読点（、）の多い文があります（1 文に 3 つまで）");

  if (/顧客/.test(body)) add("customer", "customer", "「顧客」と書いています（読む人に向けた呼び方にする）");
  return found;
}

// 決まりに反する言い回しを見つける。本人の文（allow）に同じものがあれば、本人の書き方として指摘しない
// （「顧客」は本人の文にあっても、投稿では読む人に向けた呼び方にするので指摘する）
export function styleProblems(text: string, opts: StyleOptions = {}): StyleProblem[] {
  const found = detect(text, opts);
  if (found.size === 0) return [];
  const own = new Set<string>();
  for (const a of opts.allow ?? []) if (a.trim()) for (const id of detect(a, { ...opts, allow: [] }).keys()) own.add(id);
  own.delete("customer");
  return [...found.entries()].filter(([id]) => !own.has(id)).map(([, p]) => p);
}

// 画面に出す 1 行（見つからなければ null）
export function styleNotice(problems: StyleProblem[]): string | null {
  if (problems.length === 0) return null;
  return problems.map((p) => p.label).join("・");
}

// 口調の文から、絵文字を使ってよいかを読む（「絵文字は 1 つまで」なら使ってよい、「絵文字なし」「絵文字は使わない」なら使わない）
export function emojiAllowed(toneText: string): boolean {
  return /絵文字/.test(toneText) && !/絵文字(は|を)?\s*(使わない|なし|無し|NG|禁止|控え|入れない)/.test(toneText);
}

// 見出し・ラベル・図解のタイトルの読点を外す（AI が決まりを守らなかったとき用。区切りは空白にする）
export function stripHeadlineCommas(s: string): string {
  return s.replace(/\s*[、，]\s*/g, " ").replace(/ {2,}/g, " ").trim();
}

// 下書きの確かめを、アカウント設計の口調（SNS ごと）と整え方から作る。
// allow: 本人の文（整える元の文・例の投稿）、question: 問いかけを頼まれた、emoji: 整え方の絵文字（auto は口調から読む）
export function draftStyleChecker(
  tones: { tone: string; toneBySns: Partial<Record<string, string>> },
  o: { allow?: string[]; question?: boolean; emoji?: "auto" | "none" | "some" } = {},
): (sns: string, text: string) => StyleProblem[] {
  return (sns, text) =>
    styleProblems(text, {
      sns,
      allow: o.allow,
      question: o.question,
      emoji: o.emoji === "some" ? true : o.emoji === "none" ? false : emojiAllowed(tones.toneBySns[sns]?.trim() || tones.tone),
    });
}

// 直しても残った言い回し（画面に出す短い文の並び）。なければ undefined（保存する形を増やさない）
export function styleLabels(problems: StyleProblem[]): string[] | undefined {
  return problems.length ? problems.map((p) => p.label) : undefined;
}
