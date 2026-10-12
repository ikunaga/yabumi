-- claim_link_domain の前の形（合言葉なし。20261012050000）も呼べるようにしておく（20261012080000 で合言葉を受け取る形に変えた）。
-- 新しい形に変える前のコード（取り込みの途中の main、デプロイの切り替わりの間）が止まらないように。合言葉は DB で作る（24 バイトの乱数）。
-- 新しいコードはすべて合言葉つきの形を呼ぶので、両方が行き渡ったら消してよい
create function public.claim_link_domain(p_owner uuid, p_project uuid, p_domain text, p_daily int, p_total int)
  returns text
  language sql
  security definer
  set search_path = ''
as $$
  select public.claim_link_domain(p_owner, p_project, p_domain, encode(extensions.gen_random_bytes(24), 'hex'), p_daily, p_total);
$$;

revoke execute on function public.claim_link_domain(uuid, uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.claim_link_domain(uuid, uuid, text, int, int) to service_role;
