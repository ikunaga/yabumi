-- 投稿のフォーマットの画像の設定に「上の小さい文」（label）を足す（2026-11-20 オーナーの指示。見出しを 2 段にする。
-- お手本: 連想映画クイズの画像の下のほうに、小さい色の文字「連想映画クイズ」、その下に大きい白い文字「この画像から連想される映画は？」）。
-- label は任意・1〜20 字（空欄の言葉 {…} を使える。型の文にない空欄を断るのはアプリ。src/lib/post-formats/image.ts）。ほかの決まりは 20261117120000 と同じ。
-- 名前のない check（20261117120000 で列と一緒に作った）を、名前を付けて作り直す
do $$
declare
  c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.post_formats'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%''prompt''%''headline''%';
  if c is null then
    raise exception 'post_formats の画像の check が見つかりません';
  end if;
  execute format('alter table public.post_formats drop constraint %I', c);
end;
$$;

alter table public.post_formats add constraint post_formats_image_shape check (
  jsonb_typeof(image) = 'object'
  and (image - array['prompt', 'scene', 'style', 'size', 'headline', 'label']::text[]) = '{}'::jsonb
  and (image = '{}'::jsonb or (
    -- キーがないと jsonb_typeof は null になり、check は null を通してしまうので coalesce で false にする
    coalesce(jsonb_typeof(image->'prompt'), '') = 'string'
    and char_length(btrim(image->>'prompt')) between 1 and 600
    and coalesce(image->>'scene', '') in ('fill', 'ai')
    and coalesce(jsonb_typeof(image->'scene'), '') = 'string'
    and coalesce(image->>'style', '') in ('photo', 'illustration')
    and coalesce(jsonb_typeof(image->'style'), '') = 'string'
    and coalesce(image->>'size', '') in ('auto', 'portrait', 'square', 'landscape')
    and coalesce(jsonb_typeof(image->'size'), '') = 'string'
    and (coalesce(jsonb_typeof(image->'headline'), 'null') = 'null' or (
      jsonb_typeof(image->'headline') = 'string'
      and char_length(btrim(image->>'headline')) between 1 and 40
    ))
    and (coalesce(jsonb_typeof(image->'label'), 'null') = 'null' or (
      jsonb_typeof(image->'label') = 'string'
      and char_length(btrim(image->>'label')) between 1 and 20
    ))
  ))
);

comment on column public.post_formats.image is '画像の設定。{} は画像なし。prompt: 絵の説明（{空欄}・{答え} を使える）、scene: fill（空欄の言葉をそのまま）/ ai（Claude が場面に直す）、style、size（auto は送り先に合わせる）、headline: 重ねる見出しの文、label: 見出しの上に重ねる小さい文（20 字まで）';
