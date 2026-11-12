"use client";

import { Button } from "@/components/ui/button";
import { xOverMessage } from "@/lib/sns/x/send-rules";
import { type Composer } from "./use-composer";

// X の月の上限に当たるときの知らせ（② 送り先と ⑤ 送る）。送る前に「X を外す」か「X は手で投稿する」を選ぶ。
// 判定はサーバー（送信ジョブと同じ。src/lib/sns/x/send-verdict.ts）。手で投稿するを選ぶと、ほかの SNS だけ送り、X は送信の結果から手で投稿して記録する
export function XBudgetNotice({ c }: { c: Composer }) {
  const { xVerdict, xByHand, setXByHand, toggle, clearFieldError } = c;
  if (!xVerdict?.over) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border border-line bg-surface2 px-3.5 py-3 text-[13px] leading-[1.7]">
      <p>
        <span className="font-bold text-signal">● X</span> {xOverMessage(xVerdict.over, xVerdict)}。
        {xVerdict.over === "user" ? "月が替わると戻ります。" : ""}
      </p>
      {xByHand ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-muted">X は手で投稿します。ほかの SNS を送ったあと、送信の結果の「X に手で投稿する」から投稿して記録できます。</span>
          <Button type="button" variant="text" size="sm" onClick={() => setXByHand(false)}>
            やめる
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => toggle("x")}>
            X を外す
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setXByHand(true);
              clearFieldError("targets");
            }}
          >
            X は手で投稿する
          </Button>
        </div>
      )}
    </div>
  );
}
