// LP（トップ）の画面の見本を撮るための、見本用のアカウントとデータ（docs/architecture.md の 4.29）。見本は駅前のパン屋「こむぎ日和」（D34）。
// オーナーの実データは使わない。ローカルの Supabase だけで使い、撮り終えたら消す。本番では使わない。
//
//   node scripts/lp-demo.mjs seed    見本用の利用者 lp-demo@yabumi.test と、架空のパン屋「こむぎ日和」のデータを作る（作り直す）。
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
  // いまの版の利用規約・プライバシーポリシーに同意したことにする（同意の帯が見本に写らないように）
  const { currentLegalVersion } = await import("../src/lib/legal/version.ts");
  await must(admin.from("legal_consents").insert({ user_id: uid, version: currentLegalVersion(), via: "signup" }));

  // D34（2026-11-02）: 届けたい相手が広がったので、見本はアプリ以外の「駅前の小さなパン屋」にする。
  // アカウント設計の画面の記入例（src/lib/ai/product-guide.ts の PLAN_EXAMPLES.shop）とそろえる
  const project = await must(
    admin
      .from("projects")
      .insert({
        owner_id: uid,
        name: "こむぎ日和",
        product_type: "shop",
        description: "駅前の小さなパン屋。朝 7 時に焼き上がる食パンと、季節のパンを並べています。火曜定休。",
        target_audience: "朝の通勤前にパンを買いたい、駅を使う 30 代の会社員",
      })
      .select("id")
      .single(),
  );
  const pid = project.id;
  await must(
    admin.from("project_destinations").insert([
      { owner_id: uid, project_id: pid, kind: "site", label: "お店の地図と営業時間", url: "https://example.com/komugi-biyori", position: 0 },
      { owner_id: uid, project_id: pid, kind: "booking", label: "パンの取り置き", url: "https://example.com/komugi-biyori/reserve", position: 1 },
    ]),
  );

  const accounts = {};
  for (const [sns, handle, name] of [
    ["x", "komugi_biyori", "こむぎ日和"],
    ["threads", "komugi.biyori", "こむぎ日和"],
    ["instagram", "komugi.biyori", "こむぎ日和"],
    ["facebook", "komugi.biyori", "こむぎ日和"],
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
        goal: { what: "朝 7 時に焼き上がる食パンと、季節のパン", goalType: "visit", note: "近くで働く人に、まず一度来てもらう" },
        audience: { who: "朝の通勤前にパンを買いたい、駅を使う 30 代の会社員", pain: "朝は急いでいて、どこのパン屋が開いているかわからない", where: "通勤の電車の中で、朝 7 時ごろに Instagram を見ている" },
        pillars: {
          items: [
            { name: "季節のおすすめ・新しいもの", share: 40, example: "今週から栗のデニッシュが並びます" },
            { name: "仕込み・準備のようす", share: 30, example: "朝 4 時から生地を伸ばしているところ" },
            { name: "お客さんの声", share: 15, example: "贈り物にしてくれた方の感想を紹介" },
            { name: "来る前に知っておくと便利なこと", share: 15, example: "焼き上がりの時間と、売り切れやすいパン" },
          ],
          tone: "です・ます調。あたたかく、短く。絵文字は 1 投稿に 1 つまで",
          avoid: "ほかのお店を悪く言わない。宣伝だけの投稿を続けない",
        },
        hashtags: { items: [{ tag: "パン屋巡り", why: "近くのパン屋を探している人が見ている", when: "「季節のおすすめ」の柱のとき" }] },
        ownership: { mode: "dedicated", reason: "お店の名前で探されるので、お店のアカウントにする" },
        profile: { displayName: "こむぎ日和｜駅前の小さなパン屋", handle: "komugi_biyori", handleBackups: "", bio: "駅前の小さなパン屋「こむぎ日和」。朝 7 時に焼き上がる食パンと、季節のパンのお知らせをしています。火曜定休。", link: "https://example.com/komugi-biyori", bySns: {} },
        cadence: { frequency: "週に 6 本ほど", roles: { x: "その日に焼いたものと、売り切れのお知らせを短く", threads: "X と同じ内容を、少し丁寧な言葉で", instagram: "パンの写真で、季節の新作を見せる" } },
        first_month: { goal: "毎週決めた本数を出し続ける", metrics: "地図・取り置きのページへのクリックと、来てくれた人の数", kpis: ["link_clicks", "outcomes", "posts"], weekly: { x: 3, threads: 2, instagram: 1 }, startedOn: ymdOffset(monday, -7) },
      },
    }),
  );

  // 投稿: 先週と今週の投稿済み、これからの予約、日付のない下書き
  const posts = [
    { body: "今週から栗のデニッシュが並びます。焼き上がりは朝 7 時と 11 時の 2 回です。", at: jst(ymdOffset(monday, -6), "07:00"), targets: ["x", "threads"], published: true },
    { body: "朝 4 時、食パンの生地を伸ばしているところ。この時間がいちばん好きです。", at: jst(ymdOffset(monday, -4), "07:30"), targets: ["x", "threads", "instagram", "facebook"], published: true },
    { body: "贈り物にしてくださった方から「みんなで取り合いになった」とお便りをいただきました。うれしいです。", at: jst(ymdOffset(monday, -2), "12:00"), targets: ["x"], published: true },
    { body: "売り切れやすいのは、くるみのカンパーニュと塩バターパン。お昼までに来ていただくと確実です。", at: jst(monday, "07:00"), targets: ["x", "threads"], published: true },
    { body: "あしたは定休日です。水曜の朝 7 時に、焼きたての食パンでお待ちしています。", at: jst(ymdOffset(monday, 1), "18:00"), targets: ["x", "threads"], published: false },
    { body: "秋のパン、3 種類そろいました。栗・さつまいも・りんご。", at: jst(ymdOffset(monday, 3), "07:00"), targets: ["instagram", "facebook"], published: false },
    { body: "週末の朝、焼き上がりの時間をお知らせします。", at: jst(ymdOffset(monday, 5), "07:00"), targets: ["x"], published: false },
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
  await must(admin.from("posts").insert({ owner_id: uid, project_id: pid, body: "お店の看板を新しくしました。前と後、どちらが好きですか？", status: "draft" }));

  // 投稿の数字（閲覧数など）
  for (const [i, t] of publishedTargets.entries()) {
    await admin.from("post_metrics").insert({ owner_id: uid, post_target_id: t.id, day_index: 1, values: { views: 800 + i * 370, likes: 12 + i * 5, replies: 1 + (i % 3) }, captured_at: new Date().toISOString() });
  }

  // ネタ帳
  for (const [i, body] of [
    "常連さんに「食パンの耳だけ売ってほしい」と言われた。ラスクにしたら喜ばれるかも",
    "雨の日は朝のお客さんが半分になる。雨の日だけのおまけを考えたい",
    "栗の仕込みに 2 時間かかる。皮むきの話はネタになりそう",
    "近くの小学校の子どもたちが、窓からパンを見ていた",
  ].entries()) {
    await must(admin.from("idea_notes").insert({ owner_id: uid, project_id: pid, body, created_at: new Date(Date.now() - (i + 1) * 9 * 3_600_000).toISOString() }));
  }

  // 地図・取り置きのページへのクリック（短縮リンク）と、手で入れた来店の数（直近 14 日）
  const link = await must(
    admin.from("short_links").insert({ owner_id: uid, project_id: pid, code: `lp${randomUUID().slice(0, 6)}`, destination_url: "https://example.com/komugi-biyori", kind: "profile", sns: "instagram", label: "Instagram のプロフィール" }).select("id").single(),
  );
  for (let d = 13; d >= 0; d--) {
    const day = ymdOffset(today, -d);
    const w = d < 7 ? 1.3 : 1;
    await admin.from("link_click_daily").insert({ owner_id: uid, link_id: link.id, day, device: "ios", clicks: Math.round((5 + (d % 3)) * w) });
    await admin.from("project_outcomes_daily").insert({ owner_id: uid, project_id: pid, day, action: "visit", count: Math.round((2 + (d % 3)) * w) });
  }

  const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  console.log(`作りました。プロジェクト ${pid}`);
  console.log(`ログイン: ${process.argv[3] ?? "http://localhost:3102"}/auth/confirm?token_hash=${linkData.properties.hashed_token}&type=magiclink&next=/projects/${pid}`);
}

const cmd = process.argv[2];
if (cmd === "seed") await seed();
else if (cmd === "remove") await remove();
else console.log("使い方: node scripts/lp-demo.mjs seed [アプリの URL] | remove");
