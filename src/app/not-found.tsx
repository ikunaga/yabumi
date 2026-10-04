import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-16 text-center">
      <p className="text-sm tracking-[0.15em] text-muted">404</p>
      <h1 className="font-heading text-2xl font-bold">ページが見つかりません</h1>
      <p className="text-[14px] text-muted">URL が変わったか、削除された可能性があります。</p>
      <ButtonLink href="/projects" variant="secondary" className="mt-2">
        プロジェクト一覧へ
      </ButtonLink>
    </main>
  );
}
