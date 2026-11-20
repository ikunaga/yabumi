-- 自動の回の画像に見出しを重ねる見た目（docs/design/auto-sample-image.md の 3.・11.。段取り ④。PM が依存と進め方を了承）
-- auto_plans.image に look（見出しの色・書体・置き方）を足せるようにする。形は auto_image_valid（表の check と save_auto_plan が同じものを使う）。
-- look がなければ既定の見た目（藍・すっきり・左に控えめ）で描く。見出しを重ねない（headline = none）ときは look を持たない
create or replace function public.auto_image_valid(p_kind text, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p = '{}'::jsonb or (
    jsonb_typeof(p) = 'object'
    and not exists (select 1 from jsonb_object_keys(p) k where k not in ('source', 'style', 'size', 'headline', 'look'))
    and (select count(*) from jsonb_object_keys(p) k where k <> 'look') = 4
    and p->>'source' in ('format', 'ai')
    and p->>'style' in ('photo', 'illustration')
    and p->>'size' in ('auto', 'portrait', 'square', 'landscape')
    and p->>'headline' in ('none', 'format', 'ai')
    and (p->>'source' <> 'format' or p_kind = 'series')
    and (p->>'headline' <> 'format' or p->>'source' = 'format')
    and (p_kind <> 'product' or p->>'style' = 'illustration')
    and (
      not (p ? 'look')
      or (
        p->>'headline' <> 'none'
        and jsonb_typeof(p->'look') = 'object'
        and not exists (select 1 from jsonb_object_keys(p->'look') k where k not in ('palette', 'brand', 'font', 'textStyle'))
        and (select count(*) from jsonb_object_keys(p->'look')) = 4
        and p->'look'->>'palette' in ('ai', 'kinari', 'sumi', 'wakakusa', 'sakura', 'sora', 'brand')
        and coalesce(p->'look'->>'brand' ~ '^#[0-9a-fA-F]{6}$', false)
        and p->'look'->>'font' in ('gothic', 'rounded', 'mincho', 'hand', 'pen')
        and p->'look'->>'textStyle' in ('quiet', 'bottom', 'band', 'center', 'big')
      )
    )
  );
$$;
revoke all on function public.auto_image_valid(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.auto_image_valid(text, jsonb) to authenticated, service_role;
