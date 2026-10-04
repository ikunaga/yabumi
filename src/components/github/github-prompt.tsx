import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { dismissGithubPrompt } from "@/lib/github/actions";

// 概要の「いまやること」の前に出す、任意の最初の一歩。つないだか、飛ばしたら出さない
export function GithubPrompt({ projectId, configured }: { projectId: string; configured: boolean }) {
  return (
    <section aria-labelledby="github-prompt-title" className="flex items-center gap-5 rounded-lg border border-border bg-surface px-6 py-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:px-4">
      <div className="flex flex-1 flex-col gap-1">
        <p className="text-xs tracking-[0.15em] text-muted">最初に（任意）</p>
        <h2 id="github-prompt-title" className="text-base font-bold">
          GitHub をつなぐ
        </h2>
        <p className="text-sm leading-[1.7] text-muted">
          アプリのリポジトリをつなぐと、AI がファイルを読んで、アプリの紹介文（どんなアプリか）を下書きします。紹介文は、アカウント設計の相談や投稿のネタの材料になります。非公開でも大丈夫です。
        </p>
      </div>
      <div className="flex items-center gap-3 max-sm:justify-between">
        <form action={dismissGithubPrompt.bind(null, projectId)}>
          <button type="submit" className="text-sm text-muted hover:text-fg hover:underline">
            今はしない
          </button>
        </form>
        {configured ? (
          <Link href={`/projects/${projectId}/github`} className={buttonClass({ variant: "secondary", size: "sm" })}>
            GitHub をつなぐ
          </Link>
        ) : (
          <span className="flex items-center gap-2">
            <span className="text-xs text-muted">準備中</span>
            <Button variant="secondary" size="sm" disabled>
              GitHub をつなぐ
            </Button>
          </span>
        )}
      </div>
    </section>
  );
}
