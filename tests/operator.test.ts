// 運営者の判定（docs/architecture.md の 4.29）。メールアドレスの確認が済んでいない人は運営者にしない（セキュリティ確認 2026-11-21 の L6）
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));

const { isOperatorUser } = await import("@/lib/waitlist/operator");
const { currentOperatorEmail } = await import("@/lib/waitlist/operator-server");

const LIST = "owner@example.com, ops@example.com";
const confirmed = { email: "Owner@Example.com", email_confirmed_at: "2026-11-01T00:00:00Z" };

describe("isOperatorUser", () => {
  it("一覧にあり、確認が済んでいれば運営者", () => {
    expect(isOperatorUser(confirmed, LIST)).toBe(true);
  });
  it("確認が済んでいなければ、一覧にあっても運営者にしない", () => {
    expect(isOperatorUser({ email: "owner@example.com", email_confirmed_at: null }, LIST)).toBe(false);
    expect(isOperatorUser({ email: "owner@example.com" }, LIST)).toBe(false);
  });
  it("一覧にない・一覧が空・利用者がいないときは運営者にしない", () => {
    expect(isOperatorUser({ ...confirmed, email: "other@example.com" }, LIST)).toBe(false);
    expect(isOperatorUser(confirmed, undefined)).toBe(false);
    expect(isOperatorUser(null, LIST)).toBe(false);
  });
});

describe("currentOperatorEmail（Auth のサーバーに問い合わせた利用者で決める）", () => {
  afterEach(() => {
    getUser.mockReset();
    vi.unstubAllEnvs();
  });
  it("確認が済んだ運営者ならアドレスを返し、確認していなければ null（呼ぶ側は 404）", async () => {
    vi.stubEnv("OPERATOR_ADMIN_EMAILS", LIST);
    getUser.mockResolvedValueOnce({ data: { user: confirmed }, error: null });
    expect(await currentOperatorEmail()).toBe("Owner@Example.com");
    getUser.mockResolvedValueOnce({ data: { user: { email: "owner@example.com", email_confirmed_at: null } }, error: null });
    expect(await currentOperatorEmail()).toBeNull();
  });
  it("ログインしていない・問い合わせに失敗したときは null", async () => {
    vi.stubEnv("OPERATOR_ADMIN_EMAILS", LIST);
    getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await currentOperatorEmail()).toBeNull();
    getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("invalid JWT") });
    expect(await currentOperatorEmail()).toBeNull();
  });
});
