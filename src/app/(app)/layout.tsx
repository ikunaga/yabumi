import { ConsentPrompt } from "@/components/legal/consent-prompt";
import { LegalNoticeBanner } from "@/components/legal/legal-notice-banner";
import { TopBars } from "@/components/legal/top-bars";
import { requireUser } from "@/lib/auth/user";
import { hasConsented } from "@/lib/legal/consent";
import { currentLegalVersion, effectiveDateLabel } from "@/lib/legal/version";
import { createClient } from "@/lib/supabase/server";

// ログイン後の画面。枠（上部バー / サイドバー）は画面ごとに選ぶ。
// いまの版の利用規約・プライバシーポリシーに同意していない方には、上に同意の帯を出す（決定 D31。使えなくはしない）。
// その下に、規約・ポリシーの変更のお知らせの帯（施行日の前に、予定の変更があるときだけ。docs/architecture.md の 4.30）
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  const consent = await consentState();
  return (
    <div className="flex flex-1 flex-col">
      {/* 帯の高さぶん、サイドバーを縮める（project-shell.tsx の --app-top-bars） */}
      <TopBars>
        {consent && <ConsentPrompt effectiveDate={effectiveDateLabel()} changed={consent.changed} />}
        <LegalNoticeBanner />
      </TopBars>
      {children}
    </div>
  );
}

// いまの版に同意していなければ、前の版に同意していたか（再同意か）を返す。同意していれば null
async function consentState(): Promise<{ changed: boolean } | null> {
  const supabase = await createClient();
  try {
    if (await hasConsented(supabase, currentLegalVersion())) return null;
    const { count } = await supabase.from("legal_consents").select("id", { count: "exact", head: true });
    return { changed: (count ?? 0) > 0 };
  } catch (e) {
    // 読めなくても画面は出す（同意の帯だけ出さない）
    console.error("[consent] 同意の記録を読めませんでした", e instanceof Error ? e.message : e);
    return null;
  }
}
