// 直前に開いていたプロジェクト（src/lib/projects/last-project.ts。docs/architecture.md の 4.48）。
// 用語集をプロジェクトの中から開いたとき、そのプロジェクトの帯のまま出す。cookie の id は信用せず、RLS で本人のものか確かめる
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lastProjectChange, lastProjectFor } from "@/lib/projects/last-project";
import { adminClient, deleteUser, signUpNewUser, type TestClient } from "./helpers/supabase";

const admin = adminClient();
let alice: TestClient;
let bob: TestClient;
let aliceId: string;
let bobId: string;
let aliceProject: string;
let bobProject: string;

beforeAll(async () => {
  ({ client: alice, userId: aliceId } = await signUpNewUser());
  ({ client: bob, userId: bobId } = await signUpNewUser());
  aliceProject = (await alice.from("projects").insert({ name: "こむぎ日和" }).select("id").single()).data!.id;
  bobProject = (await bob.from("projects").insert({ name: "他人のお店" }).select("id").single()).data!.id;
});

afterAll(async () => {
  for (const id of [aliceId, bobId]) if (id) await deleteUser(id);
});

describe("用語集で出す帯のプロジェクト", () => {
  it("本人のプロジェクトなら、その帯（名前も本人のもの）", async () => {
    expect(await lastProjectFor(alice, aliceProject)).toEqual({ id: aliceProject, name: "こむぎ日和" });
  });

  it("他人のプロジェクトは見えないので、外の帯（名前は出ない）", async () => {
    expect(await lastProjectFor(alice, bobProject)).toBeNull();
  });

  it("消えたプロジェクト・形の違う id・cookie なしは、外の帯", async () => {
    const gone = (await alice.from("projects").insert({ name: "消すもの" }).select("id").single()).data!.id;
    await admin.from("projects").delete().eq("id", gone);
    expect(await lastProjectFor(alice, gone)).toBeNull();
    for (const bad of ["not-a-uuid", "' or 1=1 --", `${aliceProject},${bobProject}`, ""]) expect(await lastProjectFor(alice, bad)).toBeNull();
    expect(await lastProjectFor(alice, undefined)).toBeNull();
  });
});

describe("cookie を覚える・消す", () => {
  const h = (init: Record<string, string> = {}) => new Headers(init);
  const id = "11111111-1111-4111-8111-111111111111";

  it("プロジェクトの画面を開いたら覚える（下の画面も）", () => {
    expect(lastProjectChange(`/projects/${id}`, h())).toEqual({ set: id });
    expect(lastProjectChange(`/projects/${id}/compose`, h())).toEqual({ set: id });
  });

  it("プロジェクトの一覧・新しいプロジェクトを開いたら消す", () => {
    expect(lastProjectChange("/projects", h())).toBe("clear");
    expect(lastProjectChange("/projects/new", h())).toBe("clear");
  });

  it("先読みでは変えない。用語集やほかの画面・形の違う id では変えない", () => {
    expect(lastProjectChange(`/projects/${id}`, h({ "next-router-prefetch": "1" }))).toBeNull();
    expect(lastProjectChange("/projects", h({ "sec-purpose": "prefetch" }))).toBeNull();
    expect(lastProjectChange("/glossary/kgi", h())).toBeNull();
    expect(lastProjectChange("/settings", h())).toBeNull();
    expect(lastProjectChange("/projects/not-a-uuid", h())).toBeNull();
  });
});
