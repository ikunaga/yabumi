# ER 図（docs/design/database_er.html）の作り直し方

```sh
node scripts/er/build.mjs
```

DB には触らない。次のものを読んで、docs/design/database_er.html を書き直す。

| ファイル                           | 中身                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| src/lib/supabase/database.types.ts | 表・列・必須・外部キーの正。型にない古い表は出さない                                                                |
| supabase/migrations/\*.sql         | 列の並び・SQL の型・主キー・一意・check の値の一覧・comment と -- コメント（schema.mjs が読む）                     |
| scripts/er/names.json              | 表と列の日本語の名前（論理名）・表の目的・補足。補足を書かなければ、マイグレーションの comment と -- コメントを使う |
| scripts/er/layout.json             | 区分（色・説明・表）・区分ごとの図の配置・制約のない参照（点線）・読むときの注意点・全体像の並び                    |

## マイグレーションを足したら

1. `supabase migration up` と `pnpm db:types` のあと（いつもの流れ）
2. 新しい列の日本語の名前を names.json に足す。新しい表は names.json と、layout.json の区分の `tables` に足し、図に出すなら `figures` の `boxes` にも置く
3. `node scripts/er/build.mjs` で作り直し、ブラウザで開いて、線や文字が重なっていないかを見る

名前の無い列・区分に無い表があると、一覧を出して止まる（`--force` を付けると、そのまま作る）。

## 図の置き方（layout.json）

- `boxes` は `[表, 列(0〜3), 上からの位置(px), 図に出す列, "ref"]`。主キーと外部キーの列はいつも出る。`"ref"` はほかの区分の表で、点線の枠で出す
- 線は隣の列どうしか、同じ列の上下で引く。離れた列をつなぐときは `lanes` に通り道の y を書く（`"元の表.列": y`）。離れた列への線に通り道がないと、作るときに警告が出る
- `dash` は制約のない参照（jsonb の中の ID など）`[元の表, 元の列, 先の表, 線に添える言葉]`
- `skip` は、その図では描かない外部キー（`"元の表.列"`）
- 持ち主（owner_id・user_id → auth.users）は全体像で説明し、区分の図には描かない
