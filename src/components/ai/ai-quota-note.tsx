// 画面の中の AI のボタンの下に出す、使えない理由の 1 行（使えるときは何も出さない）
export function AiQuotaNote({ blocked }: { blocked: string | null }) {
  if (!blocked) return null;
  return (
    <p role="status" className="text-xs leading-[1.7]">
      <span className="mr-1 font-bold text-signal">●</span>
      {blocked}
    </p>
  );
}
