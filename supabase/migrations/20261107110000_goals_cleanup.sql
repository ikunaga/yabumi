-- 目標の作り直しの段階 ④（docs/design/goals-model.md の 4.）。段階 ①〜③ が本番に出て（e5a5bed）、オーナーが ddy の写し替えを確かめた（2026-11-07）。
-- 本番の roadmaps・roadmap_items・account_plans の控え（CSV）は、オーナーが取ってある（deploy.md の 27）。
-- - 前の作りからの橋渡し（roadmaps・account_plans → goals のトリガー）を消す。アプリはもう roadmaps と first_month.weekly・startedOn に書かない
-- - roadmap_items.goal_id を not null にする（goal_id なしで足したやることは、これまでどおりトリガーが active な目標に入れる）
-- - roadmaps を消す
-- セキュリティ確認（2026-11-06）の DB-L1 を閉じる: 本人が roadmaps（消える）や account_plans の first_month.weekly・startedOn（アプリは読まない）を
-- 直接書いても、goals には入らない

-- やることは、すべて目標につながっていること（0 でなければ全体を戻す）
do $$
declare
  v_orphans integer;
begin
  select count(*) into v_orphans from public.roadmap_items where goal_id is null;
  if v_orphans <> 0 then
    raise exception 'roadmap_items without goal: %', v_orphans;
  end if;
end;
$$;

-- 橋渡しを消す
drop trigger if exists roadmaps_bridge_to_goals on public.roadmaps;
drop trigger if exists account_plans_bridge_to_goals on public.account_plans;
drop function if exists public.roadmaps_bridge_to_goals();
drop function if exists public.account_plans_bridge_to_goals();
drop function if exists public.legacy_bridge_to_goals();
drop function if exists public.sync_goal_from_legacy(uuid);
drop function if exists public.sync_goal_from_legacy_parts(uuid, boolean, boolean, text, boolean);
drop function if exists public.legacy_kpi_targets_part(jsonb, boolean);
drop function if exists public.legacy_date(text);
drop function if exists public.legacy_number(text);

-- やることは必ず目標につながる
alter table public.roadmap_items alter column goal_id set not null;

-- 前の作りの表を消す（読む関数・アプリはもうない。project_step_flags は 20261106150000 から goals を読む）
drop table public.roadmaps;
