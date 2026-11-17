-- 投稿のフォーマットの画像の設定（docs/design/format-image.md、2026-11-17 オーナーの了承 F1〜F7）。
-- 本文と画像をセットで 1 つのフォーマットにする。③ の画像で、その回の穴の言葉（シリーズなら答え）を入れた絵の説明から AI の画像をつくる。
-- 新しく預かる情報と、Anthropic・Google に送る新しい中身があるので、プライバシーポリシーの ②（docs/legal.md の「案: 投稿のフォーマットの画像」）。
-- オーナーの了承まで本番に出さない
--
-- {} は「画像なし」。設定があるときは
-- {"prompt": 絵の説明（1〜600 字。{穴} と {答えの名前} を使える）, "scene": "fill" | "ai", "style": "photo" | "illustration",
--  "size": "auto" | "portrait" | "square" | "landscape", "headline": 見出しの文（1〜40 字）| null}
-- 型の文にない穴を断る・答えや AI の穴を使うなら scene を ai に直すのはアプリ（src/lib/post-formats/image.ts）
alter table public.post_formats add column image jsonb not null default '{}'::jsonb
  check (
    jsonb_typeof(image) = 'object'
    and (image - array['prompt', 'scene', 'style', 'size', 'headline']::text[]) = '{}'::jsonb
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
    ))
  );

comment on column public.post_formats.image is '画像の設定。{} は画像なし。prompt: 絵の説明（{穴}・{答え} を使える）、scene: fill（穴の言葉をそのまま）/ ai（Claude が場面に直す）、style、size（auto は送り先に合わせる）、headline: 重ねる見出しの文';

grant insert (image) on public.post_formats to authenticated;
grant update (image) on public.post_formats to authenticated;
