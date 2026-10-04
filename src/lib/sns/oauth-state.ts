import { randomBytes, timingSafeEqual } from "node:crypto";
import { isUuid } from "@/lib/uuid";

// OAuth の state（CSRF 対策）。「つなぐ」を押したときに乱数を作って cookie に入れ、
// 戻ってきたときに URL の state と cookie の値が一致し、同じ利用者であることを確かめる。
// cookie には誰が・どのプロジェクトから始めたかも入れ、戻り先とつなぐ先のプロジェクトに使う。

export const OAUTH_STATE_MAX_AGE = 10 * 60; // 秒

export type OAuthState = { state: string; userId: string; projectId: string; createdAt: number };

export function newOAuthState(userId: string, projectId: string, now = Date.now()): OAuthState {
  return { state: randomBytes(32).toString("base64url"), userId, projectId, createdAt: now };
}

export function serializeOAuthState(s: OAuthState): string {
  return Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
}

function parse(cookieValue: string | undefined): OAuthState | null {
  if (!cookieValue) return null;
  try {
    const s = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8")) as Partial<OAuthState>;
    if (typeof s.state !== "string" || typeof s.userId !== "string" || typeof s.createdAt !== "number") return null;
    if (typeof s.projectId !== "string" || !isUuid(s.projectId)) return null;
    return s as OAuthState;
  } catch {
    return null;
  }
}

// 一致すれば cookie の中身を、しなければ null を返す
export function verifyOAuthState(
  cookieValue: string | undefined,
  returnedState: string | null,
  userId: string,
  now = Date.now(),
): OAuthState | null {
  const s = parse(cookieValue);
  if (!s || !returnedState) return null;
  const a = Buffer.from(s.state);
  const b = Buffer.from(returnedState);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (s.userId !== userId) return null;
  if (now - s.createdAt > OAUTH_STATE_MAX_AGE * 1000) return null;
  return s;
}
