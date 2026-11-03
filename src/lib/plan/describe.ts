import { KPIS } from "@/lib/metrics/kpis";
import { SNS, SNS_KEYS } from "@/lib/sns";
import { DESIRED_ACTION_DEFS, actionFromLegacyGoal, type DesiredAction } from "@/lib/projects/product-types";
import { isSplitBySns, pillarSnsLabel } from "./pillars";
import type { PlanData, SectionKey, SectionValue } from "./schema";

const OWNERSHIP_LABEL = { personal: "個人のアカウントを使う", dedicated: "専用のアカウントを作る", undecided: "まだ決めていない" } as const;

// セクションの中身を「項目名: 値」の行にする（AI の案の表示に使う）。空の項目は出さない
export function describeSection(key: SectionKey, value: SectionValue<SectionKey>): { label: string; text: string }[] {
  const rows: { label: string; text: string }[] = [];
  const add = (label: string, text: string | null | undefined) => {
    if (text && text.trim()) rows.push({ label, text: text.trim() });
  };
  switch (key) {
    case "goal": {
      const v = value as PlanData["goal"];
      add("何を広めたいか", v.what);
      // 前に保存した AI の案には、前の値（downloads・paid）が入っていることがある。読み替え、わからない値は出さない
      const action = (DESIRED_ACTION_DEFS[v.goalType as DesiredAction] ? v.goalType : actionFromLegacyGoal(v.goalType)) as DesiredAction | null;
      add("いちばんの目標（見た人にしてほしいこと）", action ? DESIRED_ACTION_DEFS[action]?.label : "");
      add("補足", v.note);
      break;
    }
    case "audience": {
      const v = value as PlanData["audience"];
      add("どんな人か", v.who);
      add("困りごと", v.pain);
      add("どこで・いつ SNS を見ているか", v.where);
      break;
    }
    case "pillars": {
      const v = value as PlanData["pillars"];
      // SNS ごとに分けているときは、柱ごとに使う SNS を添える
      const split = isSplitBySns(v.items);
      add(
        "投稿の柱",
        v.items
          .map((i) => `・${i.name}${i.share !== null ? `（${i.share}%）` : ""}${split ? `［${pillarSnsLabel(i)}］` : ""}${i.example ? ` 例: ${i.example}` : ""}`)
          .join("\n"),
      );
      add("口調", v.tone);
      for (const sns of SNS_KEYS) add(`${SNS[sns].label} の口調`, v.toneBySns?.[sns]);
      add("やらないこと", v.avoid);
      break;
    }
    case "hashtags": {
      const v = value as PlanData["hashtags"];
      for (const i of v.items) add(`#${i.tag}`, [i.why.trim(), i.when.trim() && `付けるとき: ${i.when.trim()}`].filter(Boolean).join("\n") || "（説明なし）");
      break;
    }
    case "ownership": {
      const v = value as PlanData["ownership"];
      add("持ち方", v.mode ? OWNERSHIP_LABEL[v.mode] : "");
      add("理由", v.reason);
      break;
    }
    case "profile": {
      const v = value as PlanData["profile"];
      add("表示名", v.displayName);
      add("ユーザー名", v.handle ? `@${v.handle.replace(/^@/, "")}` : "");
      add("予備のユーザー名", v.handleBackups);
      add("自己紹介文", v.bio);
      add("リンク先", v.link);
      for (const sns of SNS_KEYS) {
        const o = v.bySns?.[sns];
        if (!o) continue;
        const parts = [
          o.displayName.trim() && `表示名 ${o.displayName.trim()}`,
          o.handle.trim() && `@${o.handle.trim().replace(/^@/, "")}`,
          o.bio.trim() && `自己紹介文 ${o.bio.trim()}`,
          o.link.trim() && `リンク先 ${o.link.trim()}`,
        ].filter(Boolean);
        add(`${SNS[sns].label} 用`, parts.join("\n"));
      }
      break;
    }
    case "cadence": {
      const v = value as PlanData["cadence"];
      add("頻度", v.frequency);
      add(
        "SNS ごとの役割",
        SNS_KEYS.filter((s) => v.roles[s])
          .map((s) => `・${SNS[s]?.label ?? s}: ${v.roles[s]}`)
          .join("\n"),
      );
      break;
    }
    case "first_month": {
      const v = value as PlanData["first_month"];
      add("1 か月後の目標", v.goal);
      add("何を見て判断するか", v.metrics);
      add("数字の画面で追う数字", (v.kpis ?? []).map((k) => KPIS[k]?.label).filter(Boolean).join("、"));
      add(
        "SNS ごとの週の回数",
        SNS_KEYS.filter((s) => (v.weekly?.[s] ?? 0) > 0)
          .map((s) => `${SNS[s]?.label ?? s} 週 ${v.weekly[s]}`)
          .join("・"),
      );
      break;
    }
  }
  return rows;
}
