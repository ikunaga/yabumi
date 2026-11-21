"use client";

import { DeleteThreadButton } from "./delete-thread-button";

// 会話の画面の見出しの横の「この会話を削除する」。会話の下に削除が混ざらないように、ここに置く。
// 前は「…」のメニューだったが、スマホで何のボタンかわからず、開くと左にはみ出した（2026-11-21 オーナーの指摘）。
// 文字のボタンにし、押すとその下に確認を出す（浮かせない）
export function ThreadMenu(props: { projectId: string; threadId: string; backPath: string; keeps: string }) {
  return <DeleteThreadButton {...props} />;
}
