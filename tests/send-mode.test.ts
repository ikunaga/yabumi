// 投稿の画面の下のボタンの出し分け（送った投稿で押せない「予約する」を出さない）
import { describe, expect, it } from "vitest";
import { sendLabels, sendMode, sentStateOf } from "@/lib/posts/send-mode";

describe("sendMode", () => {
  it("まだ送っていなければ new、一部だけ送ったら partial、選んだ SNS にすべて送ったら all_sent", () => {
    expect(sendMode({ sentAny: false, toSend: 2 })).toBe("new");
    expect(sendMode({ sentAny: false, toSend: 0 })).toBe("new");
    expect(sendMode({ sentAny: true, toSend: 1 })).toBe("partial");
    expect(sendMode({ sentAny: true, toSend: 0 })).toBe("all_sent");
  });
});

describe("sendLabels", () => {
  it("一部だけ送ったときは、残りの SNS の分だとわかる文言", () => {
    expect(sendLabels("partial", 2)).toEqual({ schedule: "残りの 2 つの SNS に予約する", now: "残りを今すぐ送る" });
  });
  it("まだ送っていないときは今までどおり", () => {
    expect(sendLabels("new", 3)).toEqual({ schedule: "3 つの SNS に予約する", now: "今すぐ送る" });
    expect(sendLabels("new", 0)).toEqual({ schedule: "予約する", now: "今すぐ送る" });
  });
});

describe("sentStateOf（② の送り先と ⑤ のまとめに出す、送った配信先の本当の状態）", () => {
  const r = (status: NonNullable<Parameters<typeof sentStateOf>[0]>["status"], errorMessage: string | null = null) => ({ status, errorMessage });
  it("送っている途中（画像の処理中・送信中）は投稿済みと出さない", () => {
    expect(sentStateOf(r("preparing"))?.plain).toBe("送信中");
    expect(sentStateOf(r("publishing"))?.plain).toBe("送信中");
  });
  it("失敗・投稿済み・取り消し済みは、それぞれの言葉", () => {
    expect(sentStateOf(r("failed", "上限に達しました"))?.plain).toBe("失敗");
    expect(sentStateOf(r("published"))?.plain).toBe("投稿済み");
    expect(sentStateOf(r("deleted"))?.plain).toBe("取り消し済み");
  });
  it("送り直しを待っているものは「送り直し待ち」、まだ送っていないものは出さない", () => {
    expect(sentStateOf(r("pending", "一時的なエラー"))?.plain).toBe("送り直し待ち");
    expect(sentStateOf(r("pending"))).toBeNull();
    expect(sentStateOf(undefined)).toBeNull();
  });
});
