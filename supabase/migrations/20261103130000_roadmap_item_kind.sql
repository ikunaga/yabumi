-- やることの種類（docs/architecture.md の 4.42）。押したときの行き先を決める（post: 投稿をつくる、review: 振り返る、setup: 設定・準備の画面、other: ロードマップの行）。
-- 前に作ったやることは null のまま（画面で数字と題名・説明から推す。src/lib/roadmap/todo-kind.ts）。
-- 権限は表の単位（select・insert・update・delete。20261011300000_roadmaps_consult）なので、足す grant はない
alter table public.roadmap_items add column kind text check (kind is null or kind in ('post', 'review', 'setup', 'other'));

comment on column public.roadmap_items.kind is 'やることの種類（post・review・setup・other）。null は前に作ったもの（画面で推す）。4.42';
