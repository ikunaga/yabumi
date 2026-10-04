import { requireUser } from "@/lib/auth/user";

// ログイン後の画面。枠（上部バー / サイドバー）は画面ごとに選ぶ
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireUser();
  return <div className="flex flex-1 flex-col">{children}</div>;
}
