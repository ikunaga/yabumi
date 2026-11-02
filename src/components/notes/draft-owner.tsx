"use client";

import { useEffect, type ReactNode } from "react";
import { clearNoteDraftsOnDevice, setDraftOwner } from "@/lib/notes/draft";

// 書きかけのメモの控え（src/lib/notes/draft.ts）に、いまログインしている人を知らせる。
// 中の部品（「＋ メモ」・ネタ帳・/share）が控えを読む前に入れるよう、描くときに入れる（同じ値を入れ直すだけ）
// HTML にも印（data-draft-owner）を書き、NoteDraftOwner より先に描かれた部品も読めるようにする（getDraftOwner）
export function NoteDraftOwner({ userId }: { userId: string }) {
  setDraftOwner(userId);
  return <span hidden data-draft-owner={userId} />;
}

// ログアウトのフォーム。送る前に、この端末の書きかけと共有で受け取ったものを消す（共有の端末で次の人に残さない）
export function LogoutForm({ action, children }: { action: () => Promise<void>; children: ReactNode }) {
  return (
    <form action={action} onSubmit={() => void clearNoteDraftsOnDevice()}>
      {children}
    </form>
  );
}

// 退会したあとの画面で、この端末の書きかけと共有で受け取ったものを消す
export function ClearNoteDrafts(): ReactNode {
  useEffect(() => {
    void clearNoteDraftsOnDevice();
  }, []);
  return null;
}
