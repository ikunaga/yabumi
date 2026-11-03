-- セキュリティ確認（docs/security/2026-11-03_セキュリティ確認.md）の L1・L8。
-- L1: record_learning_term_read の「1 人 64 語まで」を数えてから足すまでの間に、同じ人の同時の呼び出しが割り込めた（同時に送った数だけ 64 を超えうる）。
--     claim_learning_tip と同じ、人ごとの advisory lock を先にかけて順に並べる
-- L8: learning_today_term は用語集にない語も覚えられる（本人の行だけ）。用語集にあるかは表示するときにアプリで確かめる、と書き直す

create or replace function public.record_learning_term_read(p_term_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_term_key is null or p_term_key !~ '^[A-Za-z0-9_]{1,64}$' then
    raise exception 'bad term key' using errcode = '22023';
  end if;
  -- 同じ人の同時の呼び出しは順に並べる（数えてから足すまでに割り込まれて、64 を超えないように）
  perform pg_advisory_xact_lock(hashtextextended('learning_term:' || v_uid::text, 0));
  update public.learning_term_reads set last_read_at = now() where user_id = v_uid and term_key = p_term_key;
  if found then
    return;
  end if;
  if (select count(*) from public.learning_term_reads where user_id = v_uid) >= 64 then
    return;
  end if;
  insert into public.learning_term_reads (user_id, term_key) values (v_uid, p_term_key)
  on conflict (user_id, term_key) do update set last_read_at = now();
end;
$$;
revoke all on function public.record_learning_term_read(text) from public, anon, authenticated, service_role;
grant execute on function public.record_learning_term_read(text) to authenticated;

comment on function public.record_learning_term_read(text) is '用語集の詳細ページを読んだと記録する（4.47）。本人は auth.uid()。1 人 64 語まで。同じ人の同時の呼び出しは advisory lock で順に並べる';
comment on function public.learning_today_term(text) is '今日の用語を日ごとに覚えて返す（4.47）。key の形だけを確かめ、用語集にあるかは表示するときにアプリで確かめる（用語集にない語は画面に出さない）。本人の行だけ';
