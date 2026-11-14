-- 概要の「● 要確認」の帯を × で閉じる（docs/architecture.md の 4.71。2026-11-14 オーナーの依頼「普通にこの通知をバツで閉じれればそれでいい」）。
-- 閉じたことはサーバーに持つ（スマホと PC で揃える）。閉じるのは関数 close_attention だけで、時刻はサーバーが決める。
-- 閉じるのは、画面に出していた項目だけ（開いてから × を押すまでに新しく出たものを、見ないまま閉じないため）。

-- ===== 送れなかった投稿: post_targets の 2 列 =====
-- failed_at: 失敗した時刻（failed に変わるたびに入れ直す）
-- attention_closed_at: 要確認の帯で閉じた時刻（failed に変わるたびに空にする。同じ配信先がまた失敗したら、新しい失敗として出す）
-- どちらも利用者には書かせない（post_targets の update は列ごとに許していて、ここで足す列は許さない。20261011220100_explicit_grants）
alter table public.post_targets add column failed_at timestamptz;
alter table public.post_targets add column attention_closed_at timestamptz;

comment on column public.post_targets.failed_at is '送れなかった（failed になった）時刻。failed に変わるたびに入れ直す';
comment on column public.post_targets.attention_closed_at is '概要の要確認の帯で閉じた時刻。failed に変わるたびに空にする（close_attention だけが入れる）';

-- これまでの失敗は、最後に変わった時刻を失敗した時刻とみなす
update public.post_targets set failed_at = updated_at where status = 'failed' and failed_at is null;

create function public.post_targets_mark_failed()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'failed' and (tg_op = 'INSERT' or old.status is distinct from 'failed') then
    new.failed_at := now();
    new.attention_closed_at := null;
  end if;
  return new;
end;
$$;
comment on function public.post_targets_mark_failed() is '配信先が failed に変わったら、失敗した時刻を入れ、要確認の帯で閉じた印を消す（また出す）';
revoke all on function public.post_targets_mark_failed() from public, anon, authenticated, service_role;

-- BEFORE のトリガーは名前の順に動く（post_targets_clear_removed_refs → post_targets_lock_sent → post_targets_mark_failed → post_targets_set_updated_at）。
-- ほかの BEFORE のトリガーは、status・failed_at・attention_closed_at を見も書きもしないので、順に左右されない
create trigger post_targets_mark_failed
  before insert or update of status on public.post_targets
  for each row execute function public.post_targets_mark_failed();

-- ===== 予約を過ぎた投稿・手で投稿する番・予定日を過ぎたやること: attention_dismissals =====
-- 項目と、閉じたときの予定日時の組で持つ（予定を動かすと合わなくなり、また出る）
create table public.attention_dismissals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('overdue', 'manual', 'todo')),
  post_id uuid references public.posts (id) on delete cascade,
  roadmap_item_id uuid references public.roadmap_items (id) on delete cascade,
  -- 投稿の予定時刻（overdue・manual）
  ref_at timestamptz,
  -- やることの予定日（todo）
  ref_on date,
  closed_at timestamptz not null default now(),
  check (
    (kind in ('overdue', 'manual') and post_id is not null and ref_at is not null and roadmap_item_id is null and ref_on is null)
    or (kind = 'todo' and roadmap_item_id is not null and ref_on is not null and post_id is null and ref_at is null)
  )
);
comment on table public.attention_dismissals is '概要の要確認の帯で閉じた項目（予約を過ぎた投稿・手で投稿する番・予定日を過ぎたやること）。書くのは close_attention だけ';

create unique index attention_dismissals_post_key on public.attention_dismissals (kind, post_id, ref_at) where post_id is not null;
create unique index attention_dismissals_item_key on public.attention_dismissals (roadmap_item_id, ref_on) where roadmap_item_id is not null;
create index attention_dismissals_project_idx on public.attention_dismissals (project_id);
create index attention_dismissals_owner_idx on public.attention_dismissals (owner_id);

alter table public.attention_dismissals enable row level security;
create policy "本人の閉じた項目だけ読める" on public.attention_dismissals
  for select to authenticated using (owner_id = (select auth.uid()));
-- 読むのは画面で要る列だけ。書くのは close_attention（security definer）だけなので、insert・update・delete は grant しない
grant select (project_id, kind, post_id, roadmap_item_id, ref_at, ref_on) on public.attention_dismissals to authenticated;

-- ===== 閉じる（画面に出していた項目だけ。時刻はサーバーが決める） =====
-- p_items: [{kind: 'failed', id: <post_target の id>} | {kind: 'overdue' | 'manual', id: <投稿の id>, stamp: <予定時刻>} | {kind: 'todo', id: <やることの id>, stamp: 'YYYY-MM-DD'}]
-- 1 つずつ、本人のプロジェクトのものか・いま本当に要確認かを確かめ、合わないものは黙って飛ばす。閉じた数を返す
create function public.close_attention(p_project_id uuid, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_kind text;
  v_id uuid;
  v_at timestamptz;
  v_on date;
  v_n integer;
  v_count integer := 0;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
begin
  if v_uid is null
     or not exists (select 1 from public.projects where id = p_project_id and owner_id = v_uid) then
    raise exception 'not your project' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many items' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    -- 形の合わない項目は飛ばす（uuid や日時に直せないものも）
    begin
      if jsonb_typeof(v_item) <> 'object' then
        continue;
      end if;
      v_kind := v_item ->> 'kind';
      v_id := (v_item ->> 'id')::uuid;
      v_at := null;
      v_on := null;
      if v_kind in ('overdue', 'manual') then
        v_at := (v_item ->> 'stamp')::timestamptz;
      elsif v_kind = 'todo' then
        v_on := (v_item ->> 'stamp')::date;
      end if;
    exception when others then
      continue;
    end;
    if v_id is null then
      continue;
    end if;

    if v_kind = 'failed' then
      -- 送れなかった配信先（「X は手で投稿する」の X は除く。src/lib/sns/x/send-rules.ts の X_BY_HAND_MESSAGE と同じ文）
      update public.post_targets t
         set attention_closed_at = now()
        from public.posts p
       where t.id = v_id
         and p.id = t.post_id
         and p.project_id = p_project_id
         and p.owner_id = v_uid
         and t.status = 'failed'
         and t.attention_closed_at is null
         and (t.error_message is null
           or t.error_message <> 'X は手で投稿することにしたので、自動では送りません。下の「X に手で投稿する」から投稿して記録できます。');
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
    elsif v_kind in ('overdue', 'manual') and v_at is not null then
      -- 予約中で、予定時刻が出していたものと同じで、その時刻を過ぎた投稿
      insert into public.attention_dismissals (owner_id, project_id, kind, post_id, ref_at)
      select v_uid, p_project_id, v_kind, p.id, p.planned_at
        from public.posts p
       where p.id = v_id
         and p.project_id = p_project_id
         and p.owner_id = v_uid
         and p.status = 'scheduled'
         and p.planned_at = v_at
         and p.planned_at <= now()
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
    elsif v_kind = 'todo' and v_on is not null then
      -- まだ済んでいないやることで、予定日が出していたものと同じで、今日（日本時間）より前。
      -- kind では絞らない（帯に出すかは画面の overdueItems が決める。kind が空のやることも投稿と推して出すので、ここで推し方を写すと食い違う）。
      -- 閉じて変わるのは本人の帯の見え方だけ
      insert into public.attention_dismissals (owner_id, project_id, kind, roadmap_item_id, ref_on)
      select v_uid, p_project_id, 'todo', i.id, i.planned_on
        from public.roadmap_items i
       where i.id = v_id
         and i.project_id = p_project_id
         and i.owner_id = v_uid
         and i.status = 'todo'
         and i.planned_on = v_on
         and i.planned_on < v_today
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
    end if;
  end loop;
  return v_count;
end;
$$;
comment on function public.close_attention(uuid, jsonb) is '概要の要確認の帯で、画面に出していた項目を閉じる（本人のプロジェクトの、いま要確認のものだけ。200 件まで）';

revoke all on function public.close_attention(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.close_attention(uuid, jsonb) to authenticated;
