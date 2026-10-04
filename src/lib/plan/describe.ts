import { SNS, SNS_KEYS } from "@/lib/sns";
import type { PlanData, SectionKey, SectionValue } from "./schema";

const GOAL_TYPE_LABEL = { downloads: "ダウンロードを増やす", paid: "課金してもらう", awareness: "まず知ってもらう", other: "その他" } as const;
const OWNERSHIP_LABEL = { personal: "個人のアカウントを使う", dedicated: "アプリ専用のアカウントを作る", undecided: "まだ決めていない" } as const;

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
      add("いちばんの目標", v.goalType ? GOAL_TYPE_LABEL[v.goalType] : "");
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
      add(
        "投稿の柱",
        v.items.map((i) => `・${i.name}${i.share !== null ? `（${i.share}%）` : ""}${i.example ? ` 例: ${i.example}` : ""}`).join("\n"),
      );
      add("口調", v.tone);
      add("やらないこと", v.avoid);
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
      break;
    }
    case "cadence": {
      const v = value as PlanData["cadence"];
      add("頻度", v.frequency);
      add(
        "SNS ごとの役割",
        SNS_KEYS.filter((s) => v.roles[s])
          .map((s) => `・${SNS[s].label}: ${v.roles[s]}`)
          .join("\n"),
      );
      break;
    }
    case "first_month": {
      const v = value as PlanData["first_month"];
      add("1 か月後の目標", v.goal);
      add("何を見て判断するか", v.metrics);
      break;
    }
  }
  return rows;
}
