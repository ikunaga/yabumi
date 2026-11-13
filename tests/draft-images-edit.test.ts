// 書きかけの控えに、整えた画像の元も入れて戻す（docs/architecture.md の 4.65）
import { describe, expect, it } from "vitest";
import type { AttachedImage } from "@/components/posts/image-attachments";
import { draftImageIds, rebuildDraftImages, toDraftImage } from "@/lib/posts/draft-images";
import { initialHeadline } from "@/lib/media/headline";
import { headlineAction } from "@/lib/media/headline";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const img = (n: number, extra: Partial<AttachedImage> = {}): AttachedImage => ({ id: id(n), previewUrl: `https://x/${n}`, altText: "", width: 1080, height: 1350, sizeBytes: 1, ...extra });
const settings = { ...initialHeadline({ width: 1080, height: 1350 }, "お店"), headline: "金曜の朝" };
const photo = img(1, { text: false });
const headlined = img(2, { altText: "写真に「金曜の朝」と添えた画像", text: true, original: photo, edit: { kind: "headline", base: photo, headline: settings } });
const loaded = (ns: number[]) => ns.map((n) => ({ ...img(n), altText: "サーバーの説明文" }));

describe("控える", () => {
  it("見出しを付けた画像は、元の画像・描き直した元・見出しの設定・文字が入っていることを控える", () => {
    expect(toDraftImage(headlined)).toEqual({ id: id(2), altText: headlined.altText, text: true, originalId: id(1), edit: { kind: "headline", baseId: id(1), headline: settings } });
    expect(toDraftImage(img(3))).toEqual({ id: id(3), altText: "" });
  });
  it("読み直す id は、画像と元を重ならずに（形の違う id は送らない）", () => {
    expect(draftImageIds([toDraftImage(headlined), toDraftImage(img(3)), { id: "bad", altText: "" }])).toEqual([id(2), id(1), id(3)]);
  });
});

describe("戻す", () => {
  it("元がそろえば「見出しを直す」と「元に戻す」が戻り、説明文は控えたもの", () => {
    const { images, missing } = rebuildDraftImages([toDraftImage(headlined)], loaded([1, 2]));
    expect(missing).toBe(0);
    expect(images[0].altText).toBe(headlined.altText);
    expect(images[0].original?.id).toBe(id(1));
    expect(images[0].edit).toMatchObject({ kind: "headline", base: { id: id(1) }, headline: settings });
    expect(headlineAction(images[0])).toBe("edit");
  });
  it("元が消えていたら整え方は戻さないが、文字が入っているとわかるので「見出しを付ける」は出さない（二重にならない）", () => {
    const { images } = rebuildDraftImages([toDraftImage(headlined)], loaded([2]));
    expect(images[0].original).toBeUndefined();
    expect(images[0].edit).toBeUndefined();
    expect(images[0].text).toBe(true);
    expect(headlineAction(images[0])).toBeNull();
  });
  it("調整した画像も、元と調整の値を戻す", () => {
    const adjusted = img(4, { text: false, original: photo, edit: { kind: "adjust", base: photo, adjust: { rotation: 90 } as never } });
    const { images } = rebuildDraftImages([toDraftImage(adjusted)], loaded([1, 4]));
    expect(images[0].edit).toMatchObject({ kind: "adjust", adjust: { rotation: 90 } });
  });
  it("前の版の控え（id と説明文だけ）は、いまのまま（開き直したときと同じ）", () => {
    const { images } = rebuildDraftImages([{ id: id(2), altText: "a" }], loaded([2]));
    expect(images[0].text).toBeUndefined();
    expect(headlineAction(images[0])).toBe("add");
  });
  it("戻せなかった画像の枚数（元の画像は数えない）", () => {
    expect(rebuildDraftImages([toDraftImage(headlined), toDraftImage(img(3))], loaded([1, 2])).missing).toBe(1);
  });
});
