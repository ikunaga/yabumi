-- 「TikTok は手で投稿する」（docs/design/tiktok.md の 17.。2026-11-14 オーナーの決定 B。PM の依頼と DDL の了承）。
-- X の「手で投稿する」と同じ作り: 配信先を failed にし、error_message に決まった文を入れる（送信ジョブは failed を取り出さないので、自動では送らない）。
-- 表と列は足さない。
-- 1. 手で投稿するの文を、SQL では public.by_hand_message の 1 か所に置く（TS は src/lib/sns/by-hand.ts の BY_HAND_MESSAGE。
--    一致は tests/tiktok-by-hand.integration.test.ts で close_attention の動きから確かめる）
-- 2. close_attention: 閉じる対象から、X に加えて TikTok の手で投稿するも除く（引数・戻り値・権限は 20261114110000_attention_dismiss のまま）
-- 3. mark_manual_target_posted: TikTok の失敗も「手で投稿した」と記録できるようにする（本人の行だけ。権限は 20261106130000_x_quote_post のまま）

create function public.by_hand_message(p_sns text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_sns
    when 'x' then 'X は手で投稿することにしたので、自動では送りません。下の「X に手で投稿する」から投稿して記録できます。'
    when 'tiktok' then 'TikTok は手で投稿することにしたので、自動では送りません。下の「TikTok に手で投稿する」から投稿して記録できます。'
  end
$$;
comment on function public.by_hand_message(text) is '「手で投稿する」を選んだ配信先の error_message の文（src/lib/sns/by-hand.ts の BY_HAND_MESSAGE と同じ）。手で投稿するがない SNS は null';
revoke all on function public.by_hand_message(text) from public, anon, authenticated, service_role;

create or replace function public.close_attention(p_project_id uuid, p_items jsonb)
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
      -- 送れなかった配信先（「X・TikTok は手で投稿する」の配信先は除く。文は public.by_hand_message の 1 か所）
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
           or t.error_message is distinct from public.by_hand_message(t.sns));
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

-- ===== 手で投稿したことの記録に、TikTok の失敗を足す =====
create or replace function public.mark_manual_target_posted(p_target_id uuid, p_url text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_url is not null and p_url <> '' and (p_url !~ '^https://' or char_length(p_url) > 2000) then
    raise exception 'invalid url' using errcode = '22023';
  end if;
  update public.post_targets t
     set status = 'published', published_at = now(), external_url = nullif(p_url, ''), error_message = null, quote_post_id = null
   where t.id = p_target_id
     and t.owner_id = (select auth.uid())
     and (
       (public.is_manual_sns(t.sns) and t.status in ('pending', 'failed'))
       or (t.sns in ('x', 'tiktok') and t.status = 'failed')
       or (t.sns = 'x' and t.status = 'pending' and t.quote_post_id is not null)
     );
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'target not found' using errcode = 'P0002';
  end if;
end;
$$;
