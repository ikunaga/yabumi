// LP（トップ）の画面の見本を撮るための、見本用のアカウントとデータ（docs/architecture.md の 4.29）。
// オーナーの実データは使わない。ローカルの Supabase だけで使い、撮り終えたら消す。本番では使わない。
//
//   node scripts/lp-demo.mjs seed    見本用の利用者 lp-demo@yabumi.test と、架空のアプリ「かけいぼ日和」のデータを作る（作り直す）。
//                                    ログイン用のリンク（マジックリンク）を表示する
//   node scripts/lp-demo.mjs remove  見本用の利用者とデータを消す
//
// 撮り方は README の「LP の画面の見本」
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url ?? "")) throw new Error("ローカルの Supabase だけで使ってください（NEXT_PUBLIC_SUPABASE_URL が localhost ではありません）");
const admin = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const EMAIL = "lp-demo@yabumi.test";

async function must(p) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

async function findUser() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === EMAIL) ?? null;
}

async function remove() {
  const u = await findUser();
  if (!u) return console.log("見本用の利用者はいません");
  await admin.from("ai_usage").delete().eq("owner_id", u.id);
  await admin.from("sns_api_usage").delete().eq("owner_id", u.id);
  await admin.auth.admin.deleteUser(u.id);
  console.log("見本用の利用者とデータを消しました");
}

// 日本時間の日付と時刻から ISO の文字列
const jst = (ymd, hm = "09:00") => new Date(`${ymd}T${hm}:00+09:00`).toISOString();
function ymdOffset(base, days) {
  const d = new Date(`${base}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return new Date(d.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

async function seed() {
  await remove();
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 月曜 0
  const monday = ymdOffset(today, -dow);

  const { data: created, error } = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true });
  if (error) throw error;
  const uid = created.user.id;

  const project = await must(
    admin
      .from("projects")
      .insert({
        owner_id: uid,
        name: "かけいぼ日和",
        description: "レシートを撮るだけで家計簿がつく iPhone・Android のアプリ。月ごとのグラフで、使いすぎに気づける。",
        app_store_url: "https://apps.apple.com/jp/app/id000000000",
        play_store_url: "https://play.google.com/store/apps/details?id=example.kakeibo",
        target_audience: "家計簿を何度も挫折した 20〜30 代の会社員",
      })
      .select("id")
      .single(),
  );
  const pid = project.id;

  const accounts = {};
  for (const [sns, handle, name] of [
    ["x", "kakeibo_biyori", "かけいぼ日和"],
    ["threads", "kakeibo_biyori", "かけいぼ日和"],
    ["instagram", "kakeibo.biyori", "かけいぼ日和"],
    ["facebook", "kakeibo.biyori", "かけいぼ日和"],
  ]) {
    const a = await must(admin.from("social_accounts").insert({ owner_id: uid, sns, external_id: `lp-demo-${sns}-${randomUUID()}`, handle, display_name: name }).select("id").single());
    accounts[sns] = a.id;
    await must(admin.from("project_social_accounts").insert({ owner_id: uid, project_id: pid, social_account_id: a.id }));
  }

  await must(
    admin.from("account_plans").insert({
      owner_id: uid,
      project_id: pid,
      data: {
        goal: { what: "3 か月で、ダウンロードを月 300 にする", goalType: "downloads", note: "" },
        audience: { pain: "家計簿をつけ始めても、入力が面倒で 1 週間で止まる", where: "X と Instagram で、節約や暮らしの投稿を見ている" },
        pillars: {
          items: [
            { name: "使いすぎに気づく小ネタ", share: 40, example: "コンビニの「ついで買い」が月いくらになるか" },
            { name: "開発の裏側", share: 30, example: "レシートの読み取りを速くした話" },
            { name: "使っている人の声", share: 30, example: "3 か月続いた人のグラフ" },
          ],
          tone: "身近で、責めない。数字は具体的に",
          avoid: "節約を押しつける言い方",
        },
        ownership: { mode: "dedicated", reason: "アプリの名前で覚えてもらうため" },
        profile: { displayName: "かけいぼ日和｜撮るだけ家計簿", handle: "kakeibo_biyori", handleBackups: "", bio: "レシートを撮るだけで家計簿がつくアプリ。使いすぎに気づく小ネタを毎週お届け。", link: "", bySns: {} },
        cadence: { frequency: "週に 6 本ほど", roles: { x: "小ネタと更新のお知らせ", instagram: "グラフの画像で見せる" } },
        first_month: { goal: "毎週決めた本数を出し続ける", metrics: "ストアページへのクリック", kpis: ["downloads", "link_clicks", "posts"], weekly: { x: 3, threads: 2, instagram: 1 }, startedOn: ymdOffset(monday, -7) },
      },
    }),
  );

  // 投稿: 先週と今週の投稿済み、これからの予約、日付のない下書き
  const posts = [
    { body: "コンビニの「ついで買い」、1 回 200 円でも月 20 回で 4,000 円。レシートを撮っておくと、月末にグラフで見えます。", at: jst(ymdOffset(monday, -6), "20:00"), targets: ["x", "threads"], published: true },
    { body: "v1.2 で、月ごとのグラフが見られるようになりました。先月と比べて、どこで使いすぎたかが一目でわかります。", at: jst(ymdOffset(monday, -4), "12:00"), targets: ["x", "threads", "instagram", "facebook"], published: true },
    { body: "家計簿が続かなかった理由の 1 位は「入力が面倒」。だから、撮るだけにしました。", at: jst(ymdOffset(monday, -2), "21:00"), targets: ["x"], published: true },
    { body: "レシートの読み取りを 2 倍速くした話。画像を小さくしてから送るだけで、待ち時間が 3 秒から 1.5 秒に。", at: jst(monday, "08:00"), targets: ["x", "threads"], published: true },
    { body: "今週の小ネタ: サブスク、いくつ入っていますか？ 先月のレシートとカードの明細から、使っていないものを探してみましょう。", at: jst(ymdOffset(monday, 1), "20:00"), targets: ["x", "threads"], published: false },
    { body: "3 か月続いた人のグラフを見せてもらいました（ご本人の了承を得ています）。", at: jst(ymdOffset(monday, 3), "12:00"), targets: ["instagram", "facebook"], published: false },
    { body: "週末のまとめ買い、何に使っていますか？", at: jst(ymdOffset(monday, 5), "10:00"), targets: ["x"], published: false },
  ];
  const publishedTargets = [];
  for (const p of posts) {
    const post = await must(admin.from("posts").insert({ owner_id: uid, project_id: pid, body: p.body, planned_at: p.at, status: "scheduled" }).select("id").single());
    for (const sns of p.targets) {
      const t = await must(
        admin
          .from("post_targets")
          .insert({
            owner_id: uid,
            post_id: post.id,
            sns,
            social_account_id: accounts[sns],
            status: p.published ? "published" : "pending",
            ...(p.published ? { published_at: p.at, external_post_id: `lp-demo-${randomUUID()}` } : {}),
          })
          .select("id")
          .single(),
      );
      if (p.published) publishedTargets.push({ id: t.id, sns });
    }
  }
  await must(admin.from("posts").insert({ owner_id: uid, project_id: pid, body: "アプリのアイコンを変えました。前と後、どちらが好きですか？", status: "draft" }));

  // 投稿の数字（閲覧数など）
  for (const [i, t] of publishedTargets.entries()) {
    await admin.from("post_metrics").insert({ owner_id: uid, post_target_id: t.id, day_index: 1, values: { views: 800 + i * 370, likes: 12 + i * 5, replies: 1 + (i % 3) }, captured_at: new Date().toISOString() });
  }

  // ネタ帳
  for (const [i, body] of [
    "朝の通勤中に、昨日のレシートを撮り忘れたことに気づいた。通知の時間を選べたらいいのに",
    "友だちに「家計簿アプリってどれも同じじゃない？」と言われた。違いを 1 行で言えるようにしたい",
    "スーパーのレシートが長すぎて、1 枚に収まらない問題",
    "妻が使い始めて 2 週間。外食が先月より 30% 減っていた",
  ].entries()) {
    await must(admin.from("idea_notes").insert({ owner_id: uid, project_id: pid, body, created_at: new Date(Date.now() - (i + 1) * 9 * 3_600_000).toISOString() }));
  }

  // ストアの数字（直近 14 日）とクリック
  const link = await must(
    admin.from("short_links").insert({ owner_id: uid, project_id: pid, code: `lp${randomUUID().slice(0, 6)}`, destination_url: "https://apps.apple.com/jp/app/id000000000", kind: "profile", sns: "x", label: "X のプロフィール" }).select("id").single(),
  );
  for (let d = 13; d >= 0; d--) {
    const day = ymdOffset(today, -d);
    const w = d < 7 ? 1.3 : 1;
    await admin.from("store_daily").insert({ owner_id: uid, project_id: pid, source: "app_store", day, values: { downloads: Math.round((6 + (d % 4)) * w) } });
    await admin.from("store_daily").insert({ owner_id: uid, project_id: pid, source: "app_store_views", day, values: { page_views: Math.round((40 + (d % 5) * 6) * w) } });
    await admin.from("link_click_daily").insert({ owner_id: uid, link_id: link.id, day, device: "ios", clicks: Math.round((5 + (d % 3)) * w) });
  }
  await admin.from("store_daily").insert({ owner_id: uid, project_id: pid, source: "revenuecat", day: today, values: { revenue: 12800, currency: "JPY" } });
  await admin.from("store_daily").insert({ owner_id: uid, project_id: pid, source: "revenuecat", day: ymdOffset(today, -7), values: { revenue: 9600, currency: "JPY" } });

  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  console.log(`作りました。プロジェクト ${pid}`);
  console.log(`ログイン: ${process.argv[3] ?? "http://localhost:3102"}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/projects/${pid}`);
}

const cmd = process.argv[2];
if (cmd === "seed") await seed();
else if (cmd === "remove") await remove();
else console.log("使い方: node scripts/lp-demo.mjs seed [アプリの URL] | remove");
