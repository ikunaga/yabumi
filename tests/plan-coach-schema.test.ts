// AI の返事の形。本物の API は呼ばない
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import { coachTurnSchema, normalizeCoachTurn, toSectionValue, toWireTurn } from "@/lib/ai/plan-coach-schema";

type Schema = { type?: string; properties?: Record<string, Schema>; additionalProperties?: unknown; anyOf?: Schema[]; items?: Schema; required?: string[] };

// 構造化出力の決まり: すべてのオブジェクトに additionalProperties: false、すべての項目が必須
function checkObjects(s: Schema, path = "$"): string[] {
  const problems: string[] = [];
  if (s.type === "object") {
    if (s.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
    const keys = Object.keys(s.properties ?? {});
    if (keys.some((k) => !(s.required ?? []).includes(k))) problems.push(`${path}: required`);
  }
  for (const [k, v] of Object.entries(s.properties ?? {})) problems.push(...checkObjects(v, `${path}.${k}`));
  for (const [i, v] of (s.anyOf ?? []).entries()) problems.push(...checkObjects(v, `${path}|${i}`));
  if (s.items) problems.push(...checkObjects(s.items, `${path}[]`));
  return problems;
}

describe("AI の返事の形", () => {
  it("構造化出力の JSON Schema に変換でき、決まりを満たす", () => {
    const format = betaZodOutputFormat(coachTurnSchema) as unknown as { type: string; schema: Schema };
    expect(format.type).toBe("json_schema");
    expect(checkObjects(format.schema)).toEqual([]);
  });

  // 大きすぎるスキーマは「compiled grammar is too large」で 400 になる（2026-10-03 に本物の API で発生）。
  // 案の中身をセクションごとの形で並べると大きくなるので、JSON 文字列で受け取る形を保つ
  it("スキーマが小さい（anyOf は 1 つ・2 択まで、全体の JSON は 2,500 文字まで）", () => {
    const format = betaZodOutputFormat(coachTurnSchema) as unknown as { schema: Schema };
    const json = JSON.stringify(format.schema);
    const anyOfs = json.match(/"anyOf"/g) ?? [];
    expect(anyOfs.length).toBeLessThanOrEqual(1);
    expect(format.schema.properties!.proposal.anyOf ?? []).toHaveLength(2);
    expect(json.length).toBeLessThan(2500);
  });

  it("質問だけの返事を受け取れる", () => {
    const t = normalizeCoachTurn({ message: " 目的から決めましょう ", choices: ["ダウンロード", " ", "まだわからない"], proposal: null });
    expect(t).toEqual({ message: "目的から決めましょう", choices: ["ダウンロード", "まだわからない"], proposal: null, proposalProblem: null });
  });

  it("案を保存する形に直す（SNS ごとの役割は配列から、使わない SNS は入れない）", () => {
    const t = normalizeCoachTurn({
      message: "案です",
      choices: [],
      proposal: {
        section: "cadence",
        options: [
          {
            title: "Threads だけで始める",
            summary: "最初は 1 つに絞る",
            pros: ["手間が少ない"],
            cons: ["届く人が限られる"],
            value_json: JSON.stringify({ frequency: "週 2〜3 回", roles: [{ sns: "threads", role: "開発の記録" }, { sns: "x", role: "同じ投稿を流す" }, { sns: "tiktok", role: " " }] }),
          },
        ],
        recommended: 5,
        reason: "続けやすいから",
      },
    });
    expect(t!.proposal!.recommended).toBe(0);
    expect(t!.proposal!.options[0].value).toEqual({ frequency: "週 2〜3 回", roles: { threads: "開発の記録", x: "同じ投稿を流す" } });
  });

  it("中身が形に合わない案は捨て、全部だめなら理由を返す（言い直させるため）", () => {
    const opt = (value_json: string) => ({ title: "a", summary: "", pros: [], cons: [], value_json });
    const t = normalizeCoachTurn({
      message: "案です",
      choices: [],
      proposal: { section: "pillars", options: [opt("{not json"), opt(JSON.stringify({ items: "x" }))], recommended: 0, reason: "" },
    });
    expect(t!.proposal).toBeNull();
    expect(t!.proposalProblem).toContain("JSON として読めません");
    expect(t!.proposalProblem).toContain("pillars の形に合いません");

    const ok = normalizeCoachTurn({
      message: "案です",
      choices: [],
      proposal: { section: "goal", options: [opt("{}"), opt(JSON.stringify({ what: "アプリ", goalType: "awareness", note: "" }))], recommended: 1, reason: "" },
    });
    expect(ok!.proposal!.options).toHaveLength(1);
    expect(ok!.proposal!.recommended).toBe(0);
    expect(ok!.proposalProblem).toBeNull();
    expect(normalizeCoachTurn({ message: 1 })).toBeNull();
  });

  it("保存した返事を、構造化出力と同じ形（value_json）に戻して履歴に渡す", () => {
    const wire = toWireTurn({
      message: "m",
      choices: [],
      proposal: { section: "cadence", recommended: 0, reason: "", options: [{ title: "t", summary: "", pros: [], cons: [], value: { frequency: "週 2 回", roles: { threads: "記録" } } }] },
    }) as { proposal: { options: { value_json: string }[] } };
    expect(JSON.parse(wire.proposal.options[0].value_json)).toEqual({ frequency: "週 2 回", roles: [{ sns: "threads", role: "記録" }] });
    // 戻したものを読み直すと、元の形になる
    expect(normalizeCoachTurn(wire)!.proposal!.options[0].value).toEqual({ frequency: "週 2 回", roles: { threads: "記録" } });
  });

  it("投稿の柱は名前のないものを除き、5 本までにする。割合が範囲外なら使わない", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ name: i === 1 ? "" : `柱${i}`, share: 10, example: "" }));
    const v = toSectionValue("pillars", { items, tone: "", avoid: "" }) as { items: unknown[] };
    expect(v.items).toHaveLength(5);
    expect(toSectionValue("pillars", { items: [{ name: "a", share: 150, example: "" }], tone: "", avoid: "" })).toBeNull();
  });
});
