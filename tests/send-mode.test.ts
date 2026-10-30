// 投稿の画面の下のボタンの出し分け（送った投稿で押せない「予約する」を出さない）
import { describe, expect, it } from "vitest";
import { sendLabels, sendMode } from "@/lib/posts/send-mode";

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
