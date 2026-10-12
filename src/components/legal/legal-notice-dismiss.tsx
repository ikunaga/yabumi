"use client";

import { useRouter } from "next/navigation";
import { legalNoticeCookie } from "@/lib/legal/notice-cookie";

// 帯を閉じる。閉じた版を cookie に覚え、画面を読み直して帯を消す（その変更については、もう出さない）
export function LegalNoticeDismiss({ version }: { version: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      aria-label="お知らせを閉じる"
      className="-my-1 shrink-0 rounded-md px-2 py-1 text-muted hover:bg-surface hover:text-fg"
      onClick={() => {
        document.cookie = legalNoticeCookie(version, location.protocol === "https:");
        router.refresh();
      }}
    >
      ×
    </button>
  );
}
