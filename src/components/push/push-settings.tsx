"use client";

import { NotReadyButton } from "@/components/ui/button";

// スマホの通知（Web Push）の端末の登録・解除、ホーム画面に追加する手順、試しに送る。
// いまは形だけ（中身は feat/web-push で作る）。お知らせの設定（/settings/notifications）の「スマホの通知」のカードに置く
export function PushSettings() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-[1.7] text-muted">この端末で、矢書からの通知を受け取れるようにします。</p>
      <NotReadyButton>この端末で通知を受け取る</NotReadyButton>
    </div>
  );
}
