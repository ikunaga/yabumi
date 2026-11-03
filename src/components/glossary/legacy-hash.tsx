"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { legacyGlossaryHashTarget } from "@/lib/glossary/terms";

// 前の 1 ページの用語集へのリンク（/glossary#<key>・/glossary#cat-<id>）を、新しいページに移す（4.49）。# のあとはサーバーに届かないので、画面で読む
export function LegacyGlossaryHash() {
  const router = useRouter();
  useEffect(() => {
    const to = legacyGlossaryHashTarget(window.location.hash);
    if (to) router.replace(to);
  }, [router]);
  return null;
}
