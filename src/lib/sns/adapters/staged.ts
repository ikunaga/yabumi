import { SnsPublishError, type ContinueResult, type PrepareState, type PublishResult } from "./types";

// Threads と Instagram の「コンテナを作る → 準備を待つ → 公開」を、1 回で待ち続けずに段階で進めるための共通部分。
// 状態の形:
// - 画像 1 枚: { kind: "single", id }
// - カルーセル: { kind: "carousel", children: [...], text } → 子がすべて準備できたら親を作り { ..., parent }
// 子の準備ができる前に親を作ると断られることがあるので、子を待ってから親を作る

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

export type StagedOps = {
  label: string;
  status: (containerId: string) => Promise<{ status: ContainerStatus; detail?: string }>;
  createCarousel: (children: string[], text: string) => Promise<string>;
  publish: (containerId: string) => Promise<string>;
  permalink: (mediaId: string) => Promise<string | null>;
  // SNS のエラーを送信ジョブの形に直す（stage は publish のときだけ "publish"）
  toError: (e: unknown, stage: "prepare" | "publish") => SnsPublishError;
};

type Single = { kind: "single"; id: string };
type Carousel = { kind: "carousel"; children: string[]; text: string; parent?: string };
type State = Single | Carousel;

function parse(state: PrepareState): State {
  const s = state as { kind?: unknown; id?: unknown; children?: unknown; text?: unknown; parent?: unknown };
  if (s.kind === "single" && typeof s.id === "string") return { kind: "single", id: s.id };
  if (s.kind === "carousel" && Array.isArray(s.children) && typeof s.text === "string") {
    return { kind: "carousel", children: (s.children as unknown[]).map(String), text: s.text, parent: typeof s.parent === "string" ? s.parent : undefined };
  }
  throw new SnsPublishError("permanent", "送信の途中の記録が読めませんでした。もう一度送ってください。");
}

function rejected(ops: StagedOps, detail?: string): SnsPublishError {
  return new SnsPublishError("permanent", `${ops.label} が投稿を受け付けませんでした（${detail ?? "ERROR"}）。画像の縦横比や大きさを確かめてください。`);
}

// 準備ができていれば公開して結果を、まだなら（進めた）状態を返す。1 回の呼び出しは数回の API の呼び出しで終わる
export async function continueStaged(ops: StagedOps, raw: PrepareState): Promise<ContinueResult> {
  const state = parse(raw);
  let ready: string | null = null;
  try {
    if (state.kind === "single") {
      const { status, detail } = await ops.status(state.id);
      if (status === "ERROR" || status === "EXPIRED") throw rejected(ops, detail ?? status);
      if (status !== "FINISHED") return { state };
      ready = state.id;
    } else if (!state.parent) {
      for (const child of state.children) {
        const { status, detail } = await ops.status(child);
        if (status === "ERROR" || status === "EXPIRED") throw rejected(ops, detail ?? status);
        if (status !== "FINISHED") return { state };
      }
      // 子がすべて準備できたので、親（カルーセル）を作る。親の準備は次に確かめる
      return { state: { ...state, parent: await ops.createCarousel(state.children, state.text) } };
    } else {
      const { status, detail } = await ops.status(state.parent);
      if (status === "ERROR" || status === "EXPIRED") throw rejected(ops, detail ?? status);
      if (status !== "FINISHED") return { state };
      ready = state.parent;
    }
  } catch (e) {
    throw ops.toError(e, "prepare");
  }

  let mediaId: string;
  try {
    mediaId = await ops.publish(ready);
  } catch (e) {
    throw ops.toError(e, "publish");
  }
  // URL は表示用。取れなくても送信は成功として扱う
  const url = await ops.permalink(mediaId).catch(() => null);
  const done: PublishResult = { externalPostId: mediaId, url };
  return { done };
}
