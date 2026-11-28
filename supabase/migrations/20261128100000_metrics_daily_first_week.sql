-- 投稿の数字を、送ってから最初の 7 日（Instagram は 8 日）は毎朝読み直す（2026-11-28 本番: Threads の 1 日目が 0 で保存され、
-- 次に読む 3 日目まで 0 のままだった。SNS の集計が遅れても、次の朝に新しい値が入るように）。
-- - 読む日: Threads・Facebook は 1〜7 日目と 30 日目、Instagram は 1〜8 日目と 31 日目。X は読むたびに費用がかかるので、いままでどおり 1・3・7・30 日目
-- - 1 日目は送ってから 24 時間以上たってから（p_now >= published_at + 1 日。いままでどおり）
-- - 1 つの配信先は、1 回の呼び出しで 1 回だけ読む（読める日のうち、いちばん新しい日の分。それより新しい日の値がもうあれば読まない）
-- - 画面と集計は、配信先ごとに day_index がいちばん大きい行を使う（numbers.ts など）ので、毎日の行がそのまま「最新の値で上書き」になる
-- 引数・返す形・権限は 20261011360000_metrics_due_skip と同じ
create or replace function public.due_post_metric_targets(
  p_insights jsonb,
  p_x jsonb default null,
  p_limit integer default 100,
  p_owner_id uuid default null,
  p_now timestamptz default now()
)
returns table (post_target_id uuid, owner_id uuid, sns text, external_post_id text, social_account_id uuid, account_external_id text, day_index smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select x.id, x.owner_id, x.sns, x.external_post_id, x.social_account_id, x.external_id, x.idx
    from (
      select distinct on (t.id) t.id, t.owner_id, t.sns::text as sns, t.external_post_id, t.social_account_id, a.external_id, d.idx::smallint as idx, t.published_at
        from public.post_targets t
        join public.social_accounts a on a.id = t.social_account_id
        join public.social_account_tokens k on k.social_account_id = a.id
        cross join lateral unnest(
          case
            when t.sns = 'instagram' then array[1, 2, 3, 4, 5, 6, 7, 8, 31]
            when t.sns = 'x' then array[1, 3, 7, 30]
            else array[1, 2, 3, 4, 5, 6, 7, 30]
          end
        ) as d(idx)
       where t.status = 'published'
         and p_insights ? t.sns::text
         and k.scopes @> array[p_insights ->> t.sns::text]
         and t.external_post_id is not null
         and t.published_at is not null
         and a.status = 'active'
         and (p_owner_id is null or t.owner_id = p_owner_id)
         and p_now >= t.published_at + make_interval(days => d.idx)
         and p_now < t.published_at + make_interval(days => d.idx + 3)
         and not exists (select 1 from public.post_metrics m where m.post_target_id = t.id and m.day_index >= d.idx)
         and (t.sns <> 'x' or (p_x is not null and public.x_metrics_room(
           t.owner_id, (p_x ->> 'cost_usd')::numeric, (p_x ->> 'budget_usd')::numeric, (p_x ->> 'user_budget_usd')::numeric, (p_x ->> 'scope_owner')::uuid)))
       order by t.id, d.idx desc
    ) x
   order by x.published_at
   limit p_limit;
$$;

revoke all on function public.due_post_metric_targets(jsonb, jsonb, integer, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.due_post_metric_targets(jsonb, jsonb, integer, uuid, timestamptz) to service_role;
