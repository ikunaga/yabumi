// 利用規約・プライバシーポリシーの版を決める、ただ 1 つの場所（決定 D31。docs/legal.md の「施行したあとの変え方」）。持ち主は実装担当2。
// 版の正は LEGAL_VERSIONS だけ。②の変更をするときに人が書き換えるのは、ここに 1 件足すことだけ。施行日（version）を過ぎると、
// 今の版（currentLegalVersion）・ページの施行日（effectiveDateLabel）・変更のお知らせの終わりが自動で切り替わる。
// 新しい本文に入れ替えるデプロイは、施行日にする。施行日を 2 か所に書かない

export type LegalDoc = "terms" | "privacy";

export type LegalRevision = {
  // 施行日（日本時間の日付、ISO の形 "YYYY-MM-DD"）。これが版の名前（同意の記録もこの値で持つ）
  version: string;
  // 変わる（変わった）文書
  docs: LegalDoc[];
  // 変わる点の要約（1 行ずつ。お知らせ・帯・メール・改定の履歴に出す）
  summary: string[];
  // 利用者に不利な変更か（料金・責任・機能を外すなど。知らせる期間が 30 日以上になる。不利でなければ 14 日以上）
  adverse: boolean;
  // 知らせ始める日（ISO）。最初の制定は null
  noticeFrom: string | null;
  // 前もって知らせずに施行した理由（noticeFrom が null のときだけ）。施行の時点で利用者が運営者だけで、運営者が了承したときに限る（docs/legal.md）
  noticeWaived?: string;
};

// 施行日の古い順。最初の 1 件は制定（2026-10-12）。施行日が先の行は「予定の変更」（upcomingLegalChange）
export const LEGAL_VERSIONS: readonly LegalRevision[] = [
  { version: "2026-10-12", docs: ["terms", "privacy"], summary: ["制定"], adverse: false, noticeFrom: null },
  {
    version: "2026-10-30",
    docs: ["privacy"],
    summary: [
      "利用規約とプライバシーポリシーに同意した記録（版・日時・どこで同意したか）を預かることを書き足しました",
      "規約やポリシーを変えるときに、施行日の前に画面とメールでお知らせする仕組みと、そのための記録と cookie を書き足しました",
    ],
    adverse: false,
    noticeFrom: null,
    noticeWaived: "施行の時点で利用者は運営者だけ（招待の前）で、運営者が了承した（2026-10-30）",
  },
  {
    // D34・D35。本番に出した日に施行した（D35 は同じ日のうちに足した）
    version: "2026-11-02",
    docs: ["terms", "privacy"],
    summary: [
      "yabumi を、アプリに限らず、宣伝したい商品・サービス・作品がある人のための道具にしました（利用規約 第 1 条）",
      "宣伝するものの種類、行き先の URL、利用者が入れる成果（買った・申し込んだ・予約などの数）を預かり、分析と AI との相談に使います（プライバシーポリシー 第 1 条・送り先・保存期間）",
      "入力欄のマイクのボタンで使う音声入力（ブラウザの音声認識の機能。yabumi は音声を受け取りません）の扱いを書き足しました（プライバシーポリシー 外部のサービスに送るもの）",
      // D35。利用者がオーナーだけのため、同じ日の版に入れた（2026-11-02 オーナーの指示）
      "AI で写真や絵をつくれるようにしました。AI で作った画像には印を付けます。実在の人に似せたり、本物の写真のように見せて誤解させたりする使い方を禁止事項に足しました（利用規約 AI の案・してはいけないこと）",
      "AI で画像をつくるときに、絵の説明を Google（Gemini API）に送ります。作った枚数と費用を記録し、候補の画像は 1 日で消します（プライバシーポリシー 送り先・預かる情報・保存期間）",
    ],
    adverse: false,
    noticeFrom: null,
    noticeWaived: "施行の時点で利用者は運営者だけ（2026-10-30 のあとも招待していない）で、運営者が了承した（2026-11-02）",
  },
  {
    // 学びの記録（今日の用語・ひとこと。4.47）。施行日は本番に出す日（デプロイが翌日以降なら PM がその日に直す）
    version: "2026-11-03",
    docs: ["privacy"],
    summary: [
      "使いながらマーケティングの用語を覚えられる「今日の用語」と「ひとこと」を足しました。読んだ用語と、出したひとことの記録を預かります（プライバシーポリシー 預かる情報・使い道・保存期間）",
    ],
    adverse: false,
    noticeFrom: null,
    noticeWaived: "施行の時点で利用者は運営者だけ（招待していない）で、運営者が了承した（2026-11-03）",
  },
  {
    // X の人気の投稿をネタの元にする（A・B。architecture.md の 4.52）。施行日は本番に出す日（デプロイが翌日以降なら PM がその日に直す）
    version: "2026-11-06",
    docs: ["terms", "privacy"],
    summary: [
      "X で人気の投稿をネタの元にできるようにしました。貼った投稿の URL と写した文を AI に送り、ネタ出しの会話に残します。yabumi の中で探すときは、検索の言葉を X に送り、公開の投稿を取り寄せて表示します（保存しません）（プライバシーポリシー 預かる情報・送り先・保存期間）",
      "X の人気の投稿を探す回数の上限と、他の人の投稿を書き写して自分のものとして投稿することの禁止を足しました（利用規約 料金と上限・してはいけないこと）",
    ],
    adverse: false,
    noticeFrom: null,
    noticeWaived: "施行の時点で利用者は運営者だけ（招待していない）で、運営者が了承した（2026-11-06）",
  },
  {
    // 絵の説明のフォーマット（architecture.md の 4.25 の ②）と、プロジェクトの数の上限（利用規約。1 日 1 版なので同じ版に入れた）。
    // 施行日は本番に出す日（了承は 2026-11-07。本番に出すのが 2026-11-09 になったので、施行日をその日に付け直した）
    version: "2026-11-09",
    docs: ["terms", "privacy"],
    summary: [
      "AI で画像をつくるときの絵の説明を、フォーマットとして登録して使い回せるようにしました。登録したフォーマットを預かり、絵の説明の案を作るときに AI（Anthropic）に送ります（プライバシーポリシー 預かる情報・送り先・保存期間）",
      "プロジェクトは 1 人 10 個まで作れるようにしました（利用規約の『料金と上限』）。",
    ],
    // 今まで無制限だったプロジェクトの数を縛るので、利用者に不利な変更（知らせる期間は置かない理由は noticeWaived）
    adverse: true,
    noticeFrom: null,
    noticeWaived: "施行の時点で利用者は運営者だけ（招待していない）で、運営者が了承した（2026-11-07）",
  },
  {
    // 投稿のフォーマット（docs/design/post-formats.md、architecture.md の 4.56。② として扱った。了承は 2026-11-10）。
    // 施行日は本番に出す日（PM が本番に出す日に合わせる）
    version: "2026-11-11",
    docs: ["privacy"],
    summary: [
      "くり返し出す投稿の型を「投稿のフォーマット」として登録し、投稿をつくるときに使えるようにしました。登録したフォーマットを預かり、AI でフォーマットの案を作るときと、フォーマットに沿って投稿に整えるときに AI（Anthropic）に送ります（プライバシーポリシー 預かる情報・使い道・送り先・保存期間）",
    ],
    adverse: false,
    noticeFrom: null,
    noticeWaived: "施行の時点で利用者は運営者だけ（招待していない）で、運営者が了承した（2026-11-10）",
  },
];

// 知らせる期間（日）。利用者に不利でない変更は 14 日以上、不利な変更は 30 日以上（2026-10-12 オーナーの決定）
export const NOTICE_DAYS = { normal: 14, adverse: 30 } as const;

// 日本時間の今日（ISO "YYYY-MM-DD"）
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

// 施行日が今日（日本時間）以前の版のうち、最新のもの
export function currentRevision(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision {
  const today = todayJst(now);
  const past = history.filter((r) => r.version <= today);
  return past.at(-1) ?? history[0];
}

// 今の版の名前（施行日の ISO）。同意の記録と再同意の比較は、これだけを使う
export function currentLegalVersion(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): string {
  return currentRevision(now, history).version;
}

// 施行日が今日より後の変更（いちばん近いもの）。なければ null。知らせ始める日の前でも返す（出すかどうかは noticeStarted で決める）
export function upcomingLegalChange(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision | null {
  const today = todayJst(now);
  return history.find((r) => r.version > today) ?? null;
}

// 知らせ始める日を過ぎているか（ページのお知らせ・帯・メールは、この日から出す）
export function noticeStarted(change: LegalRevision, now: Date = new Date()): boolean {
  return change.noticeFrom !== null && change.noticeFrom <= todayJst(now);
}

// 施行済みの版（改定の履歴。古い順）
export function publishedHistory(now: Date = new Date(), history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision[] {
  const today = todayJst(now);
  return history.filter((r) => r.version <= today);
}

// "2026-10-12" → "2026年10月12日"
export function formatLegalDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

// ページなどに出す、今の版の施行日。doc を渡すと、その文書が最後に変わった版の施行日（利用規約のページで、変わっていない規約の施行日を動かさない）
export function effectiveDateLabel(now: Date = new Date(), doc?: LegalDoc, history: readonly LegalRevision[] = LEGAL_VERSIONS): string {
  if (!doc) return formatLegalDate(currentLegalVersion(now, history));
  const changed = publishedHistory(now, history).filter((r) => r.docs.includes(doc));
  return formatLegalDate((changed.at(-1) ?? currentRevision(now, history)).version);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

// 版の一覧の決まりを確かめる（テストで使う）。問題があれば、その説明を返す
export function historyProblems(history: readonly LegalRevision[] = LEGAL_VERSIONS): string[] {
  const problems: string[] = [];
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  history.forEach((r, i) => {
    if (!iso.test(r.version)) problems.push(`${r.version}: 施行日は YYYY-MM-DD で書く`);
    if (i > 0 && r.version <= history[i - 1].version) problems.push(`${r.version}: 施行日の古い順に並べる`);
    if (!r.summary.length || !r.docs.length) problems.push(`${r.version}: 要約と、変わる文書を書く`);
    if (i === 0) return;
    if (r.noticeFrom === null && r.noticeWaived?.trim()) return;
    if (!r.noticeFrom || !iso.test(r.noticeFrom)) {
      problems.push(`${r.version}: 知らせ始める日（noticeFrom）を書く`);
      return;
    }
    const need = r.adverse ? NOTICE_DAYS.adverse : NOTICE_DAYS.normal;
    if (daysBetween(r.noticeFrom, r.version) < need) problems.push(`${r.version}: 知らせ始める日から施行日まで ${need} 日以上あける（${r.adverse ? "不利な変更" : "不利でない変更"}）`);
  });
  return problems;
}

// ログイン後の帯に出す変更。予定の変更があり、知らせ始める日を過ぎていて、その版の帯をまだ閉じていない（seenVersion と違う）ときだけ。
// 施行日を過ぎると予定の変更でなくなるので、出さない
export function legalBannerChange(now: Date, seenVersion: string | undefined, history: readonly LegalRevision[] = LEGAL_VERSIONS): LegalRevision | null {
  const change = upcomingLegalChange(now, history);
  if (!change || !noticeStarted(change, now) || seenVersion === change.version) return null;
  return change;
}
