// Instagram の「プロフィールのリンクから」（4.37）
import { describe, expect, it } from "vitest";
import { findUrls, hasProfileLinkLine, profileLinkLine, withDestinationUrl, withProfileLink } from "@/lib/posts/profile-link";

describe("入れる一言", () => {
  it("文面の URL が登録した行き先なら、その種類の言い方にする", () => {
    const destinations = [
      { kind: "site" as const, url: "https://example.com/" },
      { kind: "booking" as const, url: "https://yoyaku.example.com/shop" },
    ];
    expect(profileLinkLine({ productType: "shop", destinations, url: "https://yoyaku.example.com/shop/" })).toBe("▶︎ ご予約はプロフィールのリンクから");
    expect(profileLinkLine({ productType: "shop", destinations, url: "https://example.com" })).toBe("▶︎ くわしくはプロフィールのリンクから");
    expect(profileLinkLine({ productType: "app", destinations: [{ kind: "store", url: "https://apps.apple.com/app/id1" }], url: "https://apps.apple.com/app/id1" })).toBe(
      "▶︎ アプリはプロフィールのリンクから",
    );
  });

  it("行き先が登録にない・「そのほか」なら宣伝するものの種類で、それもなければ「くわしくは」", () => {
    expect(profileLinkLine({ productType: "app", url: "https://other.example.com" })).toBe("▶︎ アプリはプロフィールのリンクから");
    expect(profileLinkLine({ productType: "shop", url: "https://other.example.com" })).toBe("▶︎ ご予約・お店の場所はプロフィールのリンクから");
    expect(profileLinkLine({ productType: "online_shop", destinations: [{ kind: "other", url: "https://a.example.com" }], url: "https://a.example.com" })).toBe(
      "▶︎ ご購入はプロフィールのリンクから",
    );
    expect(profileLinkLine({ productType: null })).toBe("▶︎ くわしくはプロフィールのリンクから");
    expect(profileLinkLine({ productType: "bogus" })).toBe("▶︎ くわしくはプロフィールのリンクから");
  });

  it("文面に URL がないときは、最初の行き先の種類で", () => {
    expect(profileLinkLine({ productType: "creator", destinations: [{ kind: "shop", url: "https://shop.example.com" }] })).toBe("▶︎ ご購入はプロフィールのリンクから");
  });
});

describe("文面を「プロフィールのリンクから」にする", () => {
  const line = "▶︎ ご予約はプロフィールのリンクから";

  it("URL だけの行と「こちら：」の行を消し、最後に一言を入れる", () => {
    const text = "金曜の朝だけ、カンパーニュを焼きます。\n\nご予約はこちら：\nhttps://yoyaku.example.com/shop";
    expect(withProfileLink(text, line)).toBe("金曜の朝だけ、カンパーニュを焼きます。\n\n▶︎ ご予約はプロフィールのリンクから");
  });

  it("文の途中の URL は外して、文は残す", () => {
    expect(withProfileLink("予約は https://yoyaku.example.com から受けています。", line)).toBe("予約は から受けています。\n\n▶︎ ご予約はプロフィールのリンクから");
    expect(withProfileLink("詳しくはこちら→ https://example.com/a", line)).toBe(line);
  });

  it("最後の行がハッシュタグだけなら、その前に入れる", () => {
    expect(withProfileLink("焼きました。https://example.com\n#パン屋 #カンパーニュ", line)).toBe("焼きました。\n\n▶︎ ご予約はプロフィールのリンクから\n\n#パン屋 #カンパーニュ");
    expect(withProfileLink("焼きました。\n\n#パン屋", line)).toBe("焼きました。\n\n▶︎ ご予約はプロフィールのリンクから\n\n#パン屋");
  });

  it("もう一言があれば足さない（URL だけ外す）。何度押しても同じ", () => {
    const once = withProfileLink("焼きました。https://example.com", line);
    expect(withProfileLink(once, line)).toBe(once);
    expect(withProfileLink("焼きました。\n▶︎ アプリはプロフィールのリンクから\nhttps://x.example.com", line)).toBe("焼きました。\n▶︎ アプリはプロフィールのリンクから");
  });

  it("URL がない文面には、最後に一言を足す。空なら一言だけ", () => {
    expect(withProfileLink("焼きました。", line)).toBe("焼きました。\n\n▶︎ ご予約はプロフィールのリンクから");
    expect(withProfileLink("https://example.com", line)).toBe(line);
  });

  it("http の URL も外す。URL の判定", () => {
    expect(findUrls("a http://a.example.com b https://b.example.com/x.")).toEqual(["http://a.example.com", "https://b.example.com/x"]);
    expect(hasProfileLinkLine(withProfileLink("a", line))).toBe(true);
  });
});

describe("本文に行き先の URL を入れる（4.40）", () => {
  const url = "https://yoyaku.example.com";
  it("最後に URL だけの行を足す。本文が空なら URL だけ", () => {
    expect(withDestinationUrl("金曜の朝だけ焼きます。\n", url)).toBe(`金曜の朝だけ焼きます。\n\n${url}`);
    expect(withDestinationUrl("  ", url)).toBe(url);
  });

  it("最後の行がハッシュタグだけなら、その前に入れる", () => {
    expect(withDestinationUrl("焼きました。\n#パン屋 #カンパーニュ", url)).toBe(`焼きました。\n\n${url}\n\n#パン屋 #カンパーニュ`);
  });

  it("同じ URL がもうあれば変えない（末尾の / の違いは同じとみなす）", () => {
    const text = `ご予約は ${url}/ から`;
    expect(withDestinationUrl(text, url)).toBe(text);
  });

  it("入れたあとに Instagram 用にすると、URL を外して一言にする", () => {
    const line = profileLinkLine({ destinations: [{ kind: "booking", url }], url });
    expect(withProfileLink(withDestinationUrl("焼きました。\n#パン屋", url), line)).toBe("焼きました。\n\n▶︎ ご予約はプロフィールのリンクから\n\n#パン屋");
  });
});
