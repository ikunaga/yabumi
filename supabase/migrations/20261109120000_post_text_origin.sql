-- 投稿の本文を書いたのは誰か（posts.text_origin。docs/design/voice-from-posts.md の 2.3。2026-11-09 PM の了承 Q2）。
-- 過去の自分の投稿から文調をそろえる機能で、AI の文から作った投稿を、文調のメモの材料と例の投稿から外すために使う。
-- self: 本人が書いた / ai: AI の文をもとにした（ネタ出しの下書き・相談の下書き・「AI で整える」の案を採用した）。
-- null: この列を足す前からある投稿（わからない）。材料と例には、本人が書いたものとして扱う（利用者が直せる）。
-- ただし、ネタ出しの下書きから作ったとわかる投稿（ai_messages の adopted に投稿の ID が残っている）は、ここで ai にする。
-- 権限や費用には関わらない印なので、利用者が自分で直せる（posts の update は本人に許している。RLS で本人の行だけ）

alter table public.posts add column text_origin text check (text_origin is null or text_origin in ('self', 'ai'));

comment on column public.posts.text_origin is '本文を書いたのは誰か（self: 本人 / ai: AI の文をもとにした / null: 列を足す前からある投稿）。文調のメモの材料と例を選ぶのに使う';

-- 前からある投稿のうち、ネタ出しの下書きから作ったとわかるもの（会話の adopted の値が投稿の ID）
update public.posts p
   set text_origin = 'ai'
  from (
    select distinct (a.value #>> '{}')::uuid as post_id
      from public.ai_messages m
      join public.ai_threads t on t.id = m.thread_id and t.purpose = 'post_ideas'
      cross join lateral jsonb_each(case when jsonb_typeof(m.content -> 'adopted') = 'object' then m.content -> 'adopted' else '{}'::jsonb end) a
     where m.role = 'assistant'
       and jsonb_typeof(a.value) = 'string'
       and pg_catalog.pg_input_is_valid(a.value #>> '{}', 'uuid')
  ) x
 where p.id = x.post_id and p.text_origin is null;

-- 保存の関数に、本文を書いたのは誰かを足す（p_text_origin。null なら、新しい投稿は self、前からある投稿は変えない）
drop function public.save_post(uuid, uuid, text, timestamptz, text, jsonb);

create function public.save_post(
  p_post_id uuid,
  p_project_id uuid,
  p_body text,
  p_planned_at timestamptz,
  p_status text,
  p_targets jsonb,
  p_text_origin text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_post_id uuid;
begin
  if p_text_origin is not null and p_text_origin not in ('self', 'ai') then
    raise exception 'invalid text origin' using errcode = '22023';
  end if;
  if p_post_id is null then
    insert into public.posts (project_id, body, planned_at, status, text_origin)
    values (p_project_id, p_body, p_planned_at, p_status, coalesce(p_text_origin, 'self'))
    returning id into v_post_id;
  else
    update public.posts
      set body = p_body, planned_at = p_planned_at, status = p_status, text_origin = coalesce(p_text_origin, text_origin)
      where id = p_post_id and project_id = p_project_id
      returning id into v_post_id;
    if v_post_id is null then
      raise exception 'post not found' using errcode = 'P0002';
    end if;
  end if;

  -- 外された SNS の配信先を消す（送信済みのものは残す）
  delete from public.post_targets t
    where t.post_id = v_post_id
      and t.status = 'pending'
      and t.sns not in (select x->>'sns' from jsonb_array_elements(p_targets) as x);

  insert into public.post_targets (post_id, sns, title, body_override, social_account_id, quote_post_id)
  select v_post_id,
         x->>'sns',
         nullif(x->>'title', ''),
         nullif(x->>'body_override', ''),
         nullif(x->>'social_account_id', '')::uuid,
         nullif(x->>'quote_post_id', '')
    from jsonb_array_elements(p_targets) as x
  on conflict (post_id, sns) do update
    set title = excluded.title,
        body_override = excluded.body_override,
        social_account_id = excluded.social_account_id,
        quote_post_id = excluded.quote_post_id
    where public.post_targets.status = 'pending';

  return v_post_id;
end;
$$;

revoke all on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.save_post(uuid, uuid, text, timestamptz, text, jsonb, text) to authenticated;
