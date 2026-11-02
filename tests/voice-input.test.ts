import { describe, expect, it } from "vitest";
import { getRecognitionCtor, insertAtCursor, startVoiceSession, voiceErrorKind, type Recognition, type RecognitionResultEvent } from "@/lib/voice/speech";

describe("insertAtCursor", () => {
  it("カーソルの位置に足し、カーソルを足した言葉のあとにする", () => {
    expect(insertAtCursor("今日はいい天気", 3, 3, "とても")).toEqual({ value: "今日はとてもいい天気", caret: 6 });
  });
  it("選んでいる文字は置き換える", () => {
    expect(insertAtCursor("今日はいい天気", 3, 5, "悪い")).toEqual({ value: "今日は悪い天気", caret: 5 });
  });
  it("範囲の外の位置は端にそろえる", () => {
    expect(insertAtCursor("abc", 10, 12, "d")).toEqual({ value: "abcd", caret: 4 });
    expect(insertAtCursor("", 0, 0, "こんにちは")).toEqual({ value: "こんにちは", caret: 5 });
  });
  it("上限を超える分は切る。絵文字の途中では切らない", () => {
    expect(insertAtCursor("ab", 2, 2, "cdef", 4)).toEqual({ value: "abcd", caret: 4 });
    expect(insertAtCursor("ab", 2, 2, "c😀", 4)).toEqual({ value: "abc", caret: 3 });
    expect(insertAtCursor("abcd", 4, 4, "e", 4)).toEqual({ value: "abcd", caret: 4 });
    // 置き換える分は空く
    expect(insertAtCursor("abcd", 1, 3, "xyz", 4)).toEqual({ value: "axyd", caret: 3 });
  });
});

describe("getRecognitionCtor", () => {
  class Fake {}
  it("SpeechRecognition か webkitSpeechRecognition を返す。なければ null", () => {
    expect(getRecognitionCtor({ SpeechRecognition: Fake })).toBe(Fake);
    expect(getRecognitionCtor({ webkitSpeechRecognition: Fake })).toBe(Fake);
    expect(getRecognitionCtor({})).toBeNull();
    expect(getRecognitionCtor(undefined)).toBeNull();
  });
});

describe("voiceErrorKind", () => {
  it("許可がないとき・マイクがないとき・自分で止めたときを分ける", () => {
    expect(voiceErrorKind("not-allowed")).toBe("denied");
    expect(voiceErrorKind("service-not-allowed")).toBe("denied");
    expect(voiceErrorKind("audio-capture")).toBe("no_mic");
    expect(voiceErrorKind("no-speech")).toBe("no_speech");
    expect(voiceErrorKind("network")).toBe("network");
    expect(voiceErrorKind("aborted")).toBeNull();
    expect(voiceErrorKind("language-not-supported")).toBe("other");
  });
});

class FakeRecognition implements Recognition {
  static last: FakeRecognition;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: Recognition["onresult"] = null;
  onerror: Recognition["onerror"] = null;
  onend: Recognition["onend"] = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onerror?.({ error: "aborted" });
    this.onend?.();
  }
}

function event(resultIndex: number, results: [string, boolean][]): RecognitionResultEvent {
  return { resultIndex, results: Object.assign(results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })), { length: results.length }) };
}

describe("startVoiceSession", () => {
  it("日本語で続けて聞き取り、確定した言葉だけを渡す", () => {
    const finals: string[] = [];
    const interims: string[] = [];
    const ends: unknown[] = [];
    const s = startVoiceSession(FakeRecognition, { onFinal: (t) => finals.push(t), onInterim: (t) => interims.push(t), onEnd: (e) => ends.push(e) });
    const rec = FakeRecognition.last;
    expect(rec.lang).toBe("ja-JP");
    expect(rec.continuous).toBe(true);
    expect(rec.started).toBe(true);
    rec.onresult?.(event(0, [["新しいメニュー", false]]));
    rec.onresult?.(event(0, [[" 新しいメニューができました ", true], ["明日", false]]));
    expect(finals).toEqual(["新しいメニューができました"]);
    expect(interims).toEqual(["新しいメニュー", "明日"]);
    s.stop();
    expect(ends).toEqual([null]);
  });

  it("許可がないときは種類つきで終わる。終わりは 1 回だけ", () => {
    const ends: unknown[] = [];
    startVoiceSession(FakeRecognition, { onFinal: () => {}, onInterim: () => {}, onEnd: (e) => ends.push(e) });
    const rec = FakeRecognition.last;
    rec.onerror?.({ error: "not-allowed" });
    rec.onend?.();
    rec.onend?.();
    expect(ends).toEqual(["denied"]);
  });

  it("自分で止めたとき（abort）はエラーにしない", () => {
    const ends: unknown[] = [];
    const s = startVoiceSession(FakeRecognition, { onFinal: () => {}, onInterim: () => {}, onEnd: (e) => ends.push(e) });
    s.abort();
    expect(ends).toEqual([null]);
  });
});
