-- AI と相談の会話の終わり（docs/architecture.md の 4.23）。済んだ日時（closed_at）と、AI が区切ったときのまとめ（summary）。
-- 書き込みは今までどおりサーバー（secret キー）だけ。済みにするのは、サーバー関数が本人の会話であることを確かめてから行う（authenticated に update は付けない）。
-- まとめはサーバーが保存してある AI の返事から読む（利用者には書かせない）

alter table public.ai_threads
  add column closed_at timestamptz,
  add column summary text check (summary is null or char_length(summary) <= 500);

comment on column public.ai_threads.closed_at is '会話を済みにした日時。済んだ会話には発言を足せない（ai_messages_reject_closed）';
comment on column public.ai_threads.summary is 'AI が区切ったときのまとめ（相談の一覧に 1 行で出す）。AI がまとめずに終えたときは null';

-- 済んだ会話は、済みを外したり、まとめを書き換えたりできない（サーバーの書き損じも含めて）
create function public.ai_threads_keep_closed()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.closed_at is not null and (new.closed_at is distinct from old.closed_at or new.summary is distinct from old.summary) then
    raise exception 'thread is closed' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.ai_threads_keep_closed() from public, anon, authenticated, service_role;

create trigger ai_threads_keep_closed
  before update on public.ai_threads
  for each row execute function public.ai_threads_keep_closed();

-- 済んだ会話に、発言を足したり、返事（採用の印）を書き換えたりできない
create function public.ai_messages_reject_closed()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (select 1 from public.ai_threads t where t.id = new.thread_id and t.closed_at is not null) then
    raise exception 'thread is closed' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function public.ai_messages_reject_closed() from public, anon, authenticated, service_role;

create trigger ai_messages_reject_closed
  before insert or update on public.ai_messages
  for each row execute function public.ai_messages_reject_closed();
