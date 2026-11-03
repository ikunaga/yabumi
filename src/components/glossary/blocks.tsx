import type { GlossaryBlock } from "@/lib/glossary/terms";

// 用語の説明（details）の段落・箇条書き・表（4.45）。表は PC では表、スマホでは行ごとのカード（見出しと値を縦に）
export function GlossaryBlocks({ blocks }: { blocks: GlossaryBlock[] }) {
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[1.8]">
      {blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}

function Block({ block }: { block: GlossaryBlock }) {
  if (block.kind === "p") return <p>{block.text}</p>;
  if (block.kind === "list")
    return (
      <ul className="list-disc pl-5">
        {block.items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    );
  const { caption, head, rows } = block;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-[15px] font-bold">{caption}</figcaption>
      <div className="overflow-hidden rounded-md border border-line max-sm:hidden">
        <table className="w-full border-collapse text-left text-[14px] leading-[1.7]">
          <thead className="bg-surface2">
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="border-b border-line px-3 py-2 align-bottom font-bold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className="border-b border-line last:border-b-0">
                {r.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="px-3 py-2 align-top font-bold whitespace-nowrap">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="px-3 py-2 align-top">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((r) => (
          <li key={r[0]} className="rounded-md border border-line bg-surface px-3.5 py-2.5">
            <p className="font-bold">{r[0]}</p>
            <dl className="mt-1 flex flex-col gap-1 text-[14px] leading-[1.7]">
              {r.slice(1).map((cell, i) => (
                <div key={i}>
                  <dt className="text-xs text-muted">{head[i + 1]}</dt>
                  <dd>{cell}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </figure>
  );
}
