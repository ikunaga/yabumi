// 添えた画像を整えたときの元のたどり方（縦横を整える・調整する・見出しを付ける。docs/architecture.md の 4.53・4.58）。
// 最後の整え方と同じ整え方でやり直すときは、そのとき描き直した元（base）から描き直し（描き直しを重ねて画質を落とさない）、
// 違う整え方ならいまの画像に重ねる（縦横を整えてから調整しても、縦横が消えない）
export type EditKind = "aspect" | "adjust" | "headline";

type Editable = { id: string; original?: Editable; edit?: { kind: EditKind; base: Editable } };

export function editSource<T extends Editable>(image: T, kind: EditKind): T {
  return image.edit?.kind === kind ? (image.edit.base as T) : image;
}

// 差し替えたあとに要らなくなる画像の ID（元の画像・今回描き直した元・新しい画像のどれでもない、前のいまの画像とその元）
export function staleAfterEdit(image: Editable, kind: EditKind, newId: string): string[] {
  const keep = new Set([(image.original ?? image).id, editSource(image, kind).id, newId]);
  return [...new Set([image.id, image.edit?.base.id].filter((id): id is string => !!id && !keep.has(id)))];
}

// 元に戻す・外すときに要らなくなる画像の ID（元の画像は、元に戻すなら残す）
export function editedIds(image: Editable): string[] {
  return [...new Set([image.id, image.edit?.base.id].filter((id): id is string => !!id && id !== image.original?.id))];
}
