// 学びの記録（今日の用語・ひとこと。docs/architecture.md の 4.47）の RLS と、DB の関数の決まり。使い捨ての利用者だけを使う
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, anonClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let carol: TestClient;
let aliceId: string;
let bobId: string;
let carolId: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  ({ client: carol, userId: carolId } = await signUpNewUser());
});

afterAll(async () => {
  for (const id of [aliceId, bobId, carolId]) if (id) await deleteUser(id);
});

// 出したひとことを、前の日に出したことにする（日をまたいだときの確かめ）
async function backdateTips(userId: string, keys: Record<string, string>) {
  for (const [tip_key, last_shown_at] of Object.entries(keys)) {
    await admin.from("learning_tip_shows").update({ last_shown_at }).eq("user_id", userId).eq("tip_key", tip_key);
  }
}

describe("読んだ用語", () => {
  it("本人の記録だけが読める。読み直すと last_read_at だけが進む", async () => {
    expect((await alice.rpc("record_learning_term_read", { p_term_key: "persona" })).error).toBeNull();
    const first = (await alice.from("learning_term_reads").select("term_key, first_read_at, last_read_at")).data!;
    expect(first).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 20));
    await alice.rpc("record_learning_term_read", { p_term_key: "persona" });
    const again = (await alice.from("learning_term_reads").select("term_key, first_read_at, last_read_at")).data!;
    expect(again).toHaveLength(1);
    expect(again[0].first_read_at).toBe(first[0].first_read_at);
    expect(again[0].last_read_at > first[0].last_read_at).toBe(true);
    // 他人からは見えない
    expect((await bob.from("learning_term_reads").select("term_key")).data).toEqual([]);
    expect((await bob.from("learning_term_reads").select("term_key").eq("user_id", aliceId)).data).toEqual([]);
  });

  it("表には直接書けない（他人の分も自分の分も。関数からだけ）", async () => {
    expect((await alice.from("learning_term_reads").insert({ user_id: aliceId, term_key: "kgi" })).error).not.toBeNull();
    expect((await bob.from("learning_term_reads").insert({ user_id: aliceId, term_key: "kgi" })).error).not.toBeNull();
    const { data: updated } = await bob.from("learning_term_reads").update({ last_read_at: "2020-01-01T00:00:00Z" }).eq("user_id", aliceId).select("term_key");
    expect(updated ?? []).toEqual([]);
    expect((await alice.from("learning_term_reads").delete().eq("user_id", aliceId).select("term_key")).data ?? []).toEqual([]);
    expect((await admin.from("learning_term_reads").select("term_key").eq("user_id", aliceId)).data).toHaveLength(1);
  });

  it("key の形を確かめ、1 人 64 語までしか増えない", async () => {
    expect((await carol.rpc("record_learning_term_read", { p_term_key: "bad key!" })).error).not.toBeNull();
    expect((await carol.rpc("record_learning_term_read", { p_term_key: "a".repeat(65) })).error).not.toBeNull();
    for (let i = 0; i < 66; i++) await carol.rpc("record_learning_term_read", { p_term_key: `t_${i}` });
    expect((await admin.from("learning_term_reads").select("term_key").eq("user_id", carolId)).data).toHaveLength(64);
    await admin.from("learning_term_reads").delete().eq("user_id", carolId);
  });

  it("ログインしていない人は呼べない", async () => {
    expect((await anonClient().rpc("record_learning_term_read", { p_term_key: "persona" })).error).not.toBeNull();
    expect((await anonClient().rpc("claim_learning_tip", { p_candidates: ["a"] })).error).not.toBeNull();
    expect((await anonClient().rpc("learning_today_term", { p_term_key: "persona" })).error).not.toBeNull();
    expect((await anonClient().rpc("dismiss_learning_today_term")).error).not.toBeNull();
  });
});

describe("ひとこと（1 日 1 回まで）", () => {
  it("1 日 1 回まで。まだ出していないものを候補の順に、全部出したら出したのが古い順", async () => {
    expect((await bob.rpc("claim_learning_tip", { p_candidates: ["keep_going", "count_as_kpi"] })).data).toBe("keep_going");
    // 同じ日は、ほかのきっかけでも出さない
    expect((await bob.rpc("claim_learning_tip", { p_candidates: ["funnel_steps"] })).data).toBeNull();
    // 次の日: まだ出していない count_as_kpi
    await backdateTips(bobId, { keep_going: "2020-01-01T00:00:00Z" });
    expect((await bob.rpc("claim_learning_tip", { p_candidates: ["keep_going", "count_as_kpi"] })).data).toBe("count_as_kpi");
    // さらに次の日: 両方出したので、出したのが古い keep_going
    await backdateTips(bobId, { keep_going: "2020-01-01T00:00:00Z", count_as_kpi: "2020-01-02T00:00:00Z" });
    expect((await bob.rpc("claim_learning_tip", { p_candidates: ["keep_going", "count_as_kpi"] })).data).toBe("keep_going");
    // 行はひとことごとに 1 つ（上書き）
    expect((await bob.from("learning_tip_shows").select("tip_key")).data).toHaveLength(2);
    expect((await alice.from("learning_tip_shows").select("tip_key").eq("user_id", bobId)).data).toEqual([]);
    expect((await alice.from("learning_tip_shows").insert({ user_id: bobId, tip_key: "x" })).error).not.toBeNull();
  });

  it("同時に呼んでも、1 日 1 回を越えない", async () => {
    await admin.from("learning_tip_shows").delete().eq("user_id", carolId);
    const results = await Promise.all(Array.from({ length: 6 }, () => carol.rpc("claim_learning_tip", { p_candidates: ["keep_going", "count_as_kpi", "funnel_steps"] })));
    expect(results.every((r) => r.error === null)).toBe(true);
    expect(results.filter((r) => r.data !== null)).toHaveLength(1);
    expect((await admin.from("learning_tip_shows").select("tip_key").eq("user_id", carolId)).data).toHaveLength(1);
  });

  it("学びの表示をオフにしたら出さない。候補の形と数を確かめ、種類は 1 人 64 まで", async () => {
    await admin.from("learning_tip_shows").delete().eq("user_id", carolId);
    expect((await carol.rpc("claim_learning_tip", { p_candidates: [] })).error).not.toBeNull();
    expect((await carol.rpc("claim_learning_tip", { p_candidates: ["Bad Key!"] })).error).not.toBeNull();
    expect((await carol.rpc("claim_learning_tip", { p_candidates: Array.from({ length: 21 }, (_, i) => `k${i}`) })).error).not.toBeNull();
    // 64 種類を前の日に出したことにすると、65 種類目は足さない
    await admin.from("learning_tip_shows").insert(Array.from({ length: 64 }, (_, i) => ({ user_id: carolId, tip_key: `old_${i}`, last_shown_at: "2020-01-01T00:00:00Z" })));
    expect((await carol.rpc("claim_learning_tip", { p_candidates: ["brand_new"] })).data).toBeNull();
    expect((await admin.from("learning_tip_shows").select("tip_key").eq("user_id", carolId)).data).toHaveLength(64);
    await admin.from("learning_tip_shows").delete().eq("user_id", carolId);

    await carol.from("notification_prefs").insert({ user_id: carolId, learning_enabled: false });
    expect((await carol.rpc("claim_learning_tip", { p_candidates: ["keep_going"] })).data).toBeNull();
    expect((await admin.from("learning_tip_shows").select("tip_key").eq("user_id", carolId)).data).toEqual([]);
    expect((await carol.rpc("learning_today_term", { p_term_key: "persona" })).data).toBeNull();
    await carol.from("notification_prefs").update({ learning_enabled: true }).eq("user_id", carolId);
  });
});

describe("今日の用語と、学びの設定", () => {
  it("同じ日は同じ語。閉じたら、その日は出さない", async () => {
    expect((await alice.rpc("learning_today_term", { p_term_key: "kgi" })).data).toBe("kgi");
    // 状況が変わってアプリが別の語を選んでも、今日は kgi のまま
    expect((await alice.rpc("learning_today_term", { p_term_key: "kpi" })).data).toBe("kgi");
    expect((await alice.rpc("dismiss_learning_today_term")).error).toBeNull();
    expect((await alice.rpc("learning_today_term", { p_term_key: "kpi" })).data).toBeNull();
    // 閉じた日はサーバーが決める（日本時間の今日）
    const { data } = await alice.from("notification_prefs").select("learning_term_dismissed_on, learning_term_key").single();
    expect(data!.learning_term_key).toBe("kgi");
    expect(data!.learning_term_dismissed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("利用者が変えられるのは learning_enabled だけ。他人の設定は変えられない", async () => {
    expect((await alice.from("notification_prefs").update({ learning_enabled: false }).eq("user_id", aliceId)).error).toBeNull();
    expect((await alice.from("notification_prefs").update({ learning_term_key: "kpi" }).eq("user_id", aliceId)).error).not.toBeNull();
    expect((await alice.from("notification_prefs").update({ learning_term_on: "2020-01-01" }).eq("user_id", aliceId)).error).not.toBeNull();
    expect((await alice.from("notification_prefs").update({ learning_term_dismissed_on: null }).eq("user_id", aliceId)).error).not.toBeNull();
    // bob からは alice の行は見えず、変わらない
    const { data: byBob } = await bob.from("notification_prefs").update({ learning_enabled: true }).eq("user_id", aliceId).select("user_id");
    expect(byBob ?? []).toEqual([]);
    expect((await admin.from("notification_prefs").select("learning_enabled").eq("user_id", aliceId).single()).data!.learning_enabled).toBe(false);
  });

  it("退会すると、学びの記録は消える", async () => {
    const { userId } = await signUpNewUser().then(async (u) => {
      await u.client.rpc("record_learning_term_read", { p_term_key: "kpi" });
      await u.client.rpc("claim_learning_tip", { p_candidates: ["keep_going"] });
      await u.client.rpc("learning_today_term", { p_term_key: "kpi" });
      return u;
    });
    expect((await admin.from("learning_term_reads").select("term_key").eq("user_id", userId)).data).toHaveLength(1);
    await deleteUser(userId);
    expect((await admin.from("learning_term_reads").select("term_key").eq("user_id", userId)).data).toEqual([]);
    expect((await admin.from("learning_tip_shows").select("tip_key").eq("user_id", userId)).data).toEqual([]);
    expect((await admin.from("notification_prefs").select("user_id").eq("user_id", userId)).data).toEqual([]);
  });
});
