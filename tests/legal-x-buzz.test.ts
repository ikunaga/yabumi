// 2026-11-06 の版（X の人気の投稿をネタの元にする A・B。docs/legal.md の ② の案）: 版の並び・1 日 1 版・本文の新しい文
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSIONS, currentLegalVersion, effectiveDateLabel, historyProblems, legalBannerChange } from "@/lib/legal/version";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const at = (iso: string) => new Date(iso);

describe("2026-11-06 の版", () => {
  const rev = LEGAL_VERSIONS.find((r) => r.version === "2026-11-06")!;

  it("LEGAL_VERSIONS に、利用規約とプライバシーポリシーの両方の版として 2026-11-03 の次に足し、決まりを守っている", () => {
    // あとの版（2026-11-07 など）が足されても通るよう、最後ではなく 2026-11-03 の次であることを確かめる
    expect(LEGAL_VERSIONS[LEGAL_VERSIONS.findIndex((r) => r.version === "2026-11-03") + 1]).toBe(rev);
    expect(rev.docs).toEqual(["terms", "privacy"]);
    expect(rev.adverse).toBe(false);
    expect(rev.noticeFrom).toBeNull();
    expect(rev.noticeWaived).toContain("運営者だけ");
    expect(historyProblems()).toEqual([]);
  });

  it("1 日 1 版（同じ施行日の版は 1 つだけ）で、施行日の古い順", () => {
    const versions = LEGAL_VERSIONS.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
    expect(versions.filter((v) => v === "2026-11-06")).toHaveLength(1);
  });

  it("要約は案の「知らせの文」", () => {
    expect(rev.summary).toEqual([
      "X で人気の投稿をネタの元にできるようにしました。貼った投稿の URL と写した文を AI に送り、ネタ出しの会話に残します。yabumi の中で探すときは、検索の言葉を X に送り、公開の投稿を取り寄せて表示します（保存しません）（プライバシーポリシー 預かる情報・送り先・保存期間）",
      "X の人気の投稿を探す回数の上限と、他の人の投稿を書き写して自分のものとして投稿することの禁止を足しました（利用規約 料金と上限・してはいけないこと）",
    ]);
  });

  it("施行日（日本時間の 0 時）から今の版になり、両方のページの施行日が 2026年11月6日 になる", () => {
    expect(currentLegalVersion(at("2026-11-05T14:59:00Z"))).toBe("2026-11-03");
    expect(currentLegalVersion(at("2026-11-05T15:00:00Z"))).toBe("2026-11-06");
    expect(effectiveDateLabel(at("2026-11-05T15:00:00Z"), "terms")).toBe("2026年11月6日");
    expect(effectiveDateLabel(at("2026-11-05T15:00:00Z"), "privacy")).toBe("2026年11月6日");
    // 前もって知らせない版なので、施行の前にも「予定の変更」の帯は出さない
    expect(legalBannerChange(at("2026-11-05T00:00:00Z"), undefined)).toBeNull();
  });
});

describe("本文の新しい文", () => {
  const privacy = read("src/app/privacy/page.tsx");
  const terms = read("src/app/terms/page.tsx");

  it("プライバシーポリシー: 預かる情報（投稿・AI との会話・利用量と費用）", () => {
    expect(privacy).toContain("X で引用する投稿（投稿の id。利用者が X の画面で送って記録したら消します）");
    // 2026-11-06 のセキュリティ確認の L3 で、実際（探した結果から選んだ文も残る・1 日ほどで消す）に合わせて言い換えた（①）
    expect(privacy).toContain("X で人気の投稿から出したときの投稿の URL と、投稿の文（他の人が書いたもの。利用者が写して貼ったものと、本サービスの中で探した結果から選んだもの）・気になったところの控えを含む。投稿の文と気になったところは、ネタを出してから 1 日ほどで消します（URL だけ残します）");
    expect(privacy).toContain("X の API に払った額（投稿と数字の読み取り、人気の投稿を探した回数と費用）。会話や投稿、検索の言葉の中身は入りません");
  });

  it("プライバシーポリシー: 送り先（Anthropic・X）", () => {
    expect(privacy).toContain("「X で人気の投稿から」ネタを作るときの投稿の URL と、投稿の文（他の人が書いたもの。利用者が写して貼ったものと、本サービスの中で探した結果から選んだもの）・気になったところ");
    expect(privacy).toContain("人気の投稿を探すこと（公開の投稿の読み取り。探した結果の一覧は表示するだけで保存しません。結果から選んだ投稿の文は、利用者が貼った文と同じく、ネタ出しの会話の控えに 1 日ほど残ります）");
    expect(privacy).toContain("人気の投稿を探すときの検索の言葉（本サービスの鍵で送り、利用者の X のアカウントとは結びつけません）");
    expect(privacy).toContain("X に利用者の IP アドレスとブラウザーの種類が届きます");
    expect(privacy).toContain("引用の投稿は、利用者が X の画面で送るので、本サービスからは送りません");
  });

  it("プライバシーポリシー: 保存期間", () => {
    expect(privacy).toContain("X の API の費用（X の人気の投稿を探した回数と費用を含む）");
    expect(privacy).toContain("会話・投稿・絵の説明・検索の言葉の中身は入っていない");
  });

  it("利用規約: 料金と上限・してはいけないこと", () => {
    expect(terms).toContain("X の人気の投稿を探すのは、1 人 月 3 回（登録して 7 日までは月 1 回）と、本サービス全体の費用の上限があります。");
    expect(terms).toContain("他の人の SNS の投稿を、その人の許可なく、自分のものとして書き写して投稿すること（引用の機能で元の投稿を示すときを除く）");
  });
});
