-- 利用規約とプライバシーポリシーへの同意の記録（決定 D31。docs/legal.md の「施行したあとの変え方」）。
-- 利用者ごとに、同意した版（施行日の ISO 日付。src/lib/legal/version.ts の currentLegalVersion）と日時、どこで同意したかを持つ。
-- 新規登録・招待から始めたとき・ログインしたあとの同意の帯（いまの版に同意していない人。②の変更の施行後の再同意も）で記録する。
-- 誰がどの版に同意したかを示すため。退会で消える

create table public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- 同意した版（施行日）
  version date not null,
  -- signup: 新規登録の画面 / invite: 招待のメールから始めたとき / login: ログインしたあとの同意の帯 / change: 前の版に同意していた人の再同意
  via text not null check (via in ('signup', 'invite', 'login', 'change')),
  accepted_at timestamptz not null default now(),
  unique (user_id, version)
);

comment on table public.legal_consents is '利用規約・プライバシーポリシーへの同意の記録（D31）';

alter table public.legal_consents enable row level security;

create policy "legal_consents_select_own" on public.legal_consents
  for select to authenticated using ((select auth.uid()) = user_id);
-- 本人が、自分の同意を記録する（ログインしたあとの同意の帯・招待から始めたとき）。日時は DB が入れる（利用者は決められない）。
-- 版は、施行日が今日（日本時間）までのものだけ（先の版に同意したことにはできない）
create policy "legal_consents_insert_own" on public.legal_consents
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and version <= (now() at time zone 'Asia/Tokyo')::date
  );

-- 権限はポリシーと同じ操作だけ（4.17）。直したり消したりはできない（記録なので。退会のカスケードでだけ消える）
revoke all on public.legal_consents from anon, authenticated;
grant select on public.legal_consents to authenticated;
grant insert (version, via) on public.legal_consents to authenticated;
