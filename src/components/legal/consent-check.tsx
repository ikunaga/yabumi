import Link from "next/link";
import { LEGAL } from "@/lib/legal/info";

// 利用規約とプライバシーポリシーへの同意のチェック（決定 D31）。印を付けて押したときだけ同意とする（招待から始める方は、規約を一度も見ていないため）
export function ConsentCheck({ effectiveDate, invalid = false }: { effectiveDate: string; invalid?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 text-[14px] leading-[1.7] ${invalid ? "text-danger" : ""}`}>
      <input type="checkbox" name="consent" value="on" required className="mt-1 size-4 shrink-0 accent-[var(--primary)]" aria-invalid={invalid || undefined} />
      <span>
        {LEGAL.minAge} 歳以上であり、
        <Link href="/terms" target="_blank" className="text-primary hover:underline">
          利用規約
        </Link>
        と
        <Link href="/privacy" target="_blank" className="text-primary hover:underline">
          プライバシーポリシー
        </Link>
        （{effectiveDate}施行）に同意します
      </span>
    </label>
  );
}
