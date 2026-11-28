// 自動投稿の知らせのメールの文（src/lib/auto-post/mail.ts。2026-11-23 オーナーの指示「メールでも送れるようにして」）。
// 1 人 1 通にまとめる・件名は 1 番重い知らせで決める・投稿の本文は入れない・最後の決まった文と、自動投稿のメールだけを止めるワンクリック
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { autoMail, autoPostMailEnabled, autoUnsubscribeHeaders, jstDateTime, type AutoNotice } from "@/lib/auto-post/mail";

const c = { appUrl: "https://yabumi.example", unsubscribeToken: "11111111-1111-4111-8111-111111111111" };
const due = new Date("2026-11-24T00:00:00Z"); // 日本時間 11/24（火）9:00
const run = (kind: AutoNotice["kind"], over: Partial<AutoNotice> = {}): AutoNotice => ({
  kind,
  ownerId: "u",
  projectId: "p1",
  projectName: "パン屋",
  key: over.runId ?? "r1",
  planName: "毎朝のパン",
  dueAt: due,
  sns: ["x", "threads"],
  runId: "r1",
  ...over,
});

describe("autoMail", () => {
  it("日本時間の日付・曜日・時刻", () => {
    expect(jstDateTime(due)).toBe("11月24日 火曜 9:00");
    expect(jstDateTime(new Date("2026-11-24T10:05:00Z"))).toBe("11月24日 火曜 19:05");
  });

  it("1 回目の確認待ち: 件名・回し方の名前・日時・SNS の名前・画面のリンク。最後の決まった文", () => {
    const m = autoMail([run("auto_review")], c);
    expect(m.subject).toBe("yabumi: 自動投稿の確認をお願いします");
    expect(m.text).toContain("■ パン屋\n確認が要る投稿\n・「毎朝のパン」11月24日 火曜 9:00 に X・Threads に送る 1 回目の投稿です。確認するまで送りません。");
    expect(m.text).toContain("確認する: https://yabumi.example/projects/p1/auto/review?run=r1");
    expect(m.text).toContain("自動投稿を開く: https://yabumi.example/projects/p1/auto");
    expect(m.text).toContain(`自動投稿のメールを止める: https://yabumi.example/unsubscribe?t=${c.unsubscribeToken}&k=auto`);
    expect(m.text).toContain("メールの受け取り方を変える: https://yabumi.example/settings/notifications");
    expect(m.text).toMatch(/送信者: yabumi/);
    expect(m.text).toMatch(/問い合わせ: /);
  });

  it("まとめる: 止めた → 確認 → 下書きの順。同じ回の 2 時間前の知らせは、1 回目の確認待ちの行があれば出さない。プロジェクトごとにリンク", () => {
    const m = autoMail(
      [
        run("auto_held", { runId: "r2", key: "r2", projectId: "p2", projectName: "教室", planName: "季節" }),
        run("auto_remind"),
        run("auto_review"),
        run("auto_remind", { runId: "r3", key: "r3", sns: ["x"] }),
        run("auto_stop", { key: "plan:1", runId: undefined, dueAt: undefined, sns: undefined, reason: "SNS のつながりが切れています", next: "SNS をつなぎ直してから、再開してください。" }),
      ],
      c,
    );
    expect(m.subject).toBe("yabumi: 自動投稿が止まっています");
    const p1 = m.text.slice(m.text.indexOf("■ パン屋"), m.text.indexOf("自動投稿を開く: https://yabumi.example/projects/p1/auto") + "自動投稿を開く: https://yabumi.example/projects/p1/auto".length);
    expect(p1).toBe(
      [
        "■ パン屋",
        "止まっている自動投稿",
        "・「毎朝のパン」: SNS のつながりが切れています。SNS をつなぎ直してから、再開してください。",
        "確認が要る投稿",
        "・「毎朝のパン」11月24日 火曜 9:00 に X・Threads に送る 1 回目の投稿です。確認するまで送りません。",
        "  確認する: https://yabumi.example/projects/p1/auto/review?run=r1",
        "・「毎朝のパン」11月24日 火曜 9:00 に X に送る投稿を、まだ確認していません。確認するまで送りません。",
        "  確認する: https://yabumi.example/projects/p1/auto/review?run=r3",
        "自動投稿を開く: https://yabumi.example/projects/p1/auto",
      ].join("\n"),
    );
    expect(m.text).toContain("■ 教室\n下書きに残した投稿\n・「季節」11月24日 火曜 9:00 の X・Threads の投稿は、送らずに下書きに残しました。送るときは、確認して予約し直してください。\n自動投稿を開く: https://yabumi.example/projects/p2/auto");
  });

  it("送る時刻を過ぎた行のリンクは「投稿を見て送る」。確認待ちの行は「確認する」", () => {
    const m = autoMail([run("auto_remind", { runId: "r3", key: "r3", sns: ["x"] }), run("auto_expired", { runId: "r4", key: "r4", sns: ["x"] })], c);
    expect(m.text).toContain("  確認する: https://yabumi.example/projects/p1/auto/review?run=r3");
    expect(m.text).toContain("  投稿を見て送る: https://yabumi.example/projects/p1/auto/review?run=r4");
    expect(m.text).not.toContain("確認する: https://yabumi.example/projects/p1/auto/review?run=r4");
  });

  it("運営者が止めた・解除した: 決まった文だけ（理由は入れない）。件名", () => {
    const hold = { kind: "auto_hold" as const, ownerId: "u", projectId: null, projectName: "", key: "h1", planName: "" };
    const held = autoMail([hold], c);
    expect(held.subject).toBe("yabumi: 自動投稿が止まっています");
    expect(held.text).toContain("yabumi の運営が、あなたの自動投稿を止めました。");
    expect(held.text).toContain("yabumi を開く: https://yabumi.example/projects");
    expect(autoMail([{ ...hold, kind: "auto_release" }], c).subject).toBe("yabumi: 自動投稿をまた使えるようになりました");
    expect(autoMail([run("auto_held")], c).subject).toBe("yabumi: 自動投稿を送らずに下書きに残しました");
  });

  it("ワンクリックの配信の停止の見出し（RFC 8058）は、自動投稿のメールだけを止める", () => {
    expect(autoUnsubscribeHeaders(c)).toEqual({
      "List-Unsubscribe": `<https://yabumi.example/api/unsubscribe?t=${c.unsubscribeToken}&k=auto>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });
});

describe("autoPostMailEnabled", () => {
  it("AUTO_POST_MAIL=on のときだけ送る（規約の変更の施行まで、本番では送らない）", () => {
    expect(autoPostMailEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(autoPostMailEnabled({ AUTO_POST_MAIL: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(autoPostMailEnabled({ AUTO_POST_MAIL: "on" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
