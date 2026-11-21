// ホーム画面に追加する案内の手順（src/components/pwa/add-to-home.tsx）。
// iPhone の手順は、通知を送れるときだけ「お知らせの設定」の手順を足す（withPush）。パソコンの印は、形でなく、指を乗せたときの名前で書く
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IphoneSteps, PcSteps } from "@/components/pwa/add-to-home";

const text = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<[^>]+>/g, "");

describe("ホーム画面に追加する手順", () => {
  it("iPhone: 通知を送れるとき（withPush）だけ、お知らせの設定の手順がある", () => {
    expect(text(createElement(IphoneSteps, { withPush: true }))).toContain("「この端末で通知を受け取る」を押し");
    expect(text(createElement(IphoneSteps, { withPush: false }))).not.toContain("お知らせの設定");
    expect(text(createElement(IphoneSteps))).not.toContain("お知らせの設定");
  });

  it("iPhone: 同じメールアドレスで、もう一度ログインする", () => {
    expect(text(createElement(IphoneSteps))).toContain("同じメールアドレスで、もう一度ログインします");
  });

  it("パソコン: Chrome と Edge で、印に指を乗せたときの名前を書く", () => {
    const t = text(createElement(PcSteps));
    expect(t).toContain("Chrome は「インストール」");
    expect(t).toContain("Edge は「アプリを使用できます」");
  });
});
