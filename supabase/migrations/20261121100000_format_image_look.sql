-- 投稿のフォーマットの画像の設定に、見出しの見た目（look: 色・いつもの色・書体・置き方）を足す（2026-11-21 PM の依頼。オーナーの考え
-- 「フォーマットで決めたとおりに、自動の投稿もつくりたい」）。形は auto_plans.image の look（20261120100000 の auto_image_valid）と同じ。
-- 見出しがあるとき（headline が文字）だけ持てる。ほかの決まりは 20261120110000_format_image_label の post_formats_image_shape と同じ
alter table public.post_formats drop constraint post_formats_image_shape;

alter table public.post_formats add constraint post_formats_image_shape check (
  jsonb_typeof(image) = 'object'
  and (image - array['prompt', 'scene', 'style', 'size', 'headline', 'label', 'look']::text[]) = '{}'::jsonb
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
    and (coalesce(jsonb_typeof(image->'look'), 'null') = 'null' or (
      coalesce(jsonb_typeof(image->'headline'), 'null') = 'string'
      and jsonb_typeof(image->'look') = 'object'
      and ((image->'look') - array['palette', 'brand', 'font', 'textStyle']::text[]) = '{}'::jsonb
      and coalesce(image->'look'->>'palette', '') in ('ai', 'kinari', 'sumi', 'wakakusa', 'sakura', 'sora', 'brand')
      and coalesce(((image->'look')->>'brand') ~ '^#[0-9a-fA-F]{6}$', false)
      and coalesce(image->'look'->>'font', '') in ('gothic', 'rounded', 'mincho', 'hand', 'pen')
      and coalesce(image->'look'->>'textStyle', '') in ('quiet', 'bottom', 'band', 'center', 'big')
    ))
  ))
);

comment on column public.post_formats.image is '画像の設定。{} は画像なし。prompt: 絵の説明（{空欄}・{答え} を使える）、scene: fill（空欄の言葉をそのまま）/ ai（Claude が場面に直す）、style、size（auto は送り先に合わせる）、headline: 重ねる見出しの文、label: 見出しの上に重ねる小さい文（20 字まで）、look: 見出しの見た目（palette・brand・font・textStyle。見出しがあるときだけ）';
