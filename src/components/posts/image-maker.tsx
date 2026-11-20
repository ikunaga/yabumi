"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import { draftImageText } from "@/lib/ai/image-brief-actions";
import { photoModel, photoUnitYen } from "@/lib/ai/photo";
import type { ImageBrief } from "@/lib/ai/image-brief";
import { MAX_ALT_LENGTH } from "@/lib/media/rules";
import { bitmapToJpeg } from "@/lib/media/client-upload";
import { paletteOf, type HeadlineSettings } from "@/lib/media/headline";
import { TEMPLATE_FONTS } from "@/lib/media/template-fonts";
import { canvasToJpeg, renderTemplate } from "@/lib/media/template-render";
import {
  DIAGRAM_STYLES,
  DIAGRAM_STYLE_LABEL,
  MAX_ITEMS,
  TEMPLATE_KINDS,
  TEMPLATE_KIND_HINT,
  TEMPLATE_KIND_LABEL,
  TEMPLATE_SIZES,
  autoAlt,
  closestSize,
  defaultSizeFor,
  templateReady,
  type DiagramStyle,
  type PhotoFit,
  type TemplateInput,
  type TemplateItem,
  type TemplateKind,
  type TemplateSizeKey,
} from "@/lib/media/templates";
import type { FormatPhotoPreset } from "@/lib/post-formats/image";
import type { SnsKey } from "@/lib/sns";
import { Choice, Group } from "./maker-parts";
import { AiBadge } from "./ai-badge";
import { PhotoMaker, type PickedPhoto } from "./photo-maker";
import { BriefBar, FooterField, HeadlineFields, LabelField, PhotoFitField, SizeField, StyleFields, useTemplateStyle } from "./template-fields";

// 添えた画像が何か（添えた画像の欄で、見出しの入口を決める。4.58）。
// plain: 文字のない写真（AI の写真をそのまま）。text: 文字が主役の画像（文字のカード・図解・note のヘッダー）。
// headline: 写真に見出し。敷いた写真（photo。AI の写真なら photoAi にその記録の ID）と設定を渡し、「見出しを直す」の元にする
export type MadeImage = { kind: "plain" } | { kind: "text" } | { kind: "headline"; photo: Blob; photoAi?: string; settings: HeadlineSettings };

type MakerMode = "template" | "photo";
const modeKey = (projectId: string) => `yabumi-image-maker-mode:${projectId}`;

// 前に選んだつくり方（この端末だけ。読めなければテンプレート）
function loadMakerMode(projectId: string): MakerMode {
  try {
    return localStorage.getItem(modeKey(projectId)) === "photo" ? "photo" : "template";
  } catch {
    return "template";
  }
}

function saveMakerMode(projectId: string, mode: MakerMode) {
  try {
    localStorage.setItem(modeKey(projectId), mode);
  } catch {
    // 覚えられなくても、選んだつくり方で続ける
  }
}

export type ImageMakerProps = {
  projectId: string;
  projectName: string;
  aiEnabled: boolean;
  // 投稿の本文（AI が文字の案を考える材料）
  text: string;
  // いま選んでいる送り先（縦横比の既定を決める）
  targets: SnsKey[];
  // ai: AI で作った画像から作ったとき（サーバーが確かめて AI の印を付ける）
  onAdd: (jpeg: Blob, altText: string, ai: { jobId: string; source: "generated" | "composite" } | undefined, made: MadeImage) => Promise<boolean>;
  onClose: () => void;
  // 次に添えるのは何枚目か（1 からの番号）。1 枚目の画像の縦横（2 枚目から、それにそろえる）。送り先に Instagram があるか
  nextIndex: number;
  first: { width: number; height: number } | null;
  instagram: boolean;
  // 投稿のフォーマットの画像（docs/design/format-image.md の 2.1）。seq が変わるたびに「AI で写真・絵をつくる」を開き、縦横と見出しをフォーマットに合わせる
  preset?: FormatPhotoPreset | null;
};

// テンプレートで画像をつくる（F14 の段取り ①。docs/architecture.md の 4.25）。
// ブラウザの Canvas で描き、できた JPEG を画像の添付（4.18）と同じ流れで上げる。写真に見出しで敷いた写真は AI には送らない
// （添えるときに、見出しを直す・元に戻すの元として、添えていない画像として上げる。4.58）
// 添えても閉じずに、続けて次の画像をつくれる（絵の説明・フォーマット・候補は残る）。2 枚目からは 1 枚目の縦横にそろえる
export function ImageMaker({ projectId, projectName, aiEnabled, text, targets, onAdd, onClose, nextIndex, first, instagram, preset = null }: ImageMakerProps) {
  const suggested = useMemo(() => defaultSizeFor(targets), [targets]);
  const firstSize = first ? closestSize(first.width, first.height) : null;
  const [kind, setKind] = useState<TemplateKind>(targets.length === 1 && targets[0] === "note" ? "note" : "card");
  const [size, setSize] = useState<TemplateSizeKey>(firstSize ?? suggested.size);
  // 1 枚目が決まったら（添えた・選んだ）、縦横をそれにそろえる（あとから変えることもできる）
  const [alignedTo, setAlignedTo] = useState<TemplateSizeKey | null>(firstSize);
  if (firstSize !== alignedTo) {
    setAlignedTo(firstSize);
    if (firstSize) setSize(firstSize);
  }
  // この画面で添えたか（「✓ 添えました（画像は n 枚）」。まとめて添えたときも、いまの枚数で出す）
  const [added, setAdded] = useState(false);
  // 色・書体・文字の置き方（プロジェクトごとに前回のものを覚えておく）
  const [style, setStyle] = useTemplateStyle(projectId);
  const { font, textStyle } = style;
  const [label, setLabel] = useState("");
  const [headline, setHeadline] = useState("");
  const [subline, setSubline] = useState("");
  const [footer, setFooter] = useState(projectName);
  const [diagramStyle, setDiagramStyle] = useState<DiagramStyle>("points");
  const [diagramTitle, setDiagramTitle] = useState("");
  const [items, setItems] = useState<TemplateItem[]>([
    { title: "", text: "" },
    { title: "", text: "" },
    { title: "", text: "" },
  ]);
  // つくり方は、プロジェクトごとに前回のものを覚えておく（AI で写真をつくる人が、毎回テンプレートから切り替えなくて済むように。
  // 2026-11-18 オーナーの通しの指摘 18）。開くだけでは AI を呼ばない（押した「つくる」だけが費用になる）
  const [mode, setModeState] = useState<MakerMode>(() => loadMakerMode(projectId));
  // 「AI で写真・絵をつくる」を一度開いたら、タブを切り替えても外さない（作った候補・絵の説明を残す）
  const [photoOpened, setPhotoOpened] = useState(mode === "photo");
  function setMode(m: MakerMode) {
    setModeState(m);
    saveMakerMode(projectId, m);
  }
  // フォーマットの画像で開き直した seq（見出しの文は、写真に見出しを重ねるときに入れる）
  const [presetSeq, setPresetSeq] = useState<number | null>(null);
  if (preset && preset.seq !== presetSeq) {
    setPresetSeq(preset.seq);
    setPhotoOpened(true);
    // フォーマットの画像で開いたときは、覚えたつくり方は書き換えない（その投稿のフォーマットのため）
    setModeState("photo");
    if (preset.size !== "auto") setSize(preset.size);
  }
  // aiJobId: 写真が AI で作ったものなら、その記録の ID（添えるときに AI の印を付ける）。scene はその絵の説明（説明文に使う）
  const [shot, setShot] = useState<{ bitmap: ImageBitmap; name: string; aiJobId?: string; scene?: string } | null>(null);
  const [photoFit, setPhotoFit] = useState<PhotoFit>("frame");
  const [alt, setAlt] = useState("");
  const [altTouched, setAltTouched] = useState(false);
  const [brief, setBrief] = useState<ImageBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [drafting, startDraft] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 閉じたら画面の画像を手放す
  useEffect(() => () => shot?.bitmap.close(), [shot]);

  const palette = paletteOf(style.palette, style.brand);
  const input: TemplateInput = {
    kind,
    size,
    palette,
    fonts: TEMPLATE_FONTS[font],
    label,
    headline: kind === "diagram" ? diagramTitle : headline,
    subline,
    footer,
    diagramStyle,
    items,
    screenshot: shot ? { w: shot.bitmap.width, h: shot.bitmap.height } : null,
    photoFit,
    textStyle,
  };
  const notReady = templateReady(input);
  const altText = altTouched ? alt : autoAlt(input);

  // 入力が変わるたびに描き直す（書体の読み込みを待つので、古い描画があとから上書きしないよう番号で確かめる）
  const drawSeq = useRef(0);
  const inputKey = JSON.stringify({ ...input, fonts: font, palette: palette.key + palette.bg, shot: shot?.name });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const seq = ++drawSeq.current;
    const off = document.createElement("canvas");
    renderTemplate(off, input, shot?.bitmap ?? null)
      .then(() => {
        if (seq !== drawSeq.current) return;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext("2d")?.drawImage(off, 0, 0);
        setRenderError(false);
      })
      .catch(() => seq === drawSeq.current && setRenderError(true));
    // input は inputKey にまとめて見ている
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, mode]);

  function applyBrief(b: ImageBrief) {
    setBrief(b);
    setKind((k) => (k === "note" ? k : b.recommend));
    setLabel(b.label);
    setHeadline(b.headlines[0] ?? "");
    setSubline(b.subline);
    setDiagramTitle(b.diagram.title);
    setDiagramStyle(b.diagram.style);
    if (b.diagram.items.length) setItems(b.diagram.items);
  }

  function draft() {
    startDraft(async () => {
      setError(null);
      const res = await draftImageText(projectId, text, targets);
      if (res.error || !res.brief) {
        setError(res.error ?? "うまくいきませんでした。");
        return;
      }
      applyBrief(res.brief);
    });
  }

  async function pickShot(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      setShot({ bitmap, name: `${file.name}:${file.size}:${file.lastModified}` });
    } catch {
      setError(`「${file.name}」は画像として読めませんでした。PNG・JPEG などの画像を選んでください。`);
    }
  }

  // 押したときの欄の値で描き直して作る（見本の canvas は書体の読み込みを待って描くので、打ってすぐ押すと前の文字のままのことがあった。4.69）
  async function add() {
    if (notReady) return;
    setAdding(true);
    setError(null);
    try {
      const out = document.createElement("canvas");
      await renderTemplate(out, input, shot?.bitmap ?? null);
      const jpeg = await canvasToJpeg(out);
      const ai = kind === "screen" && shot?.aiJobId ? { jobId: shot.aiJobId, source: "composite" as const } : undefined;
      // 写真に見出しは、敷いた写真も元として上げる（添えたあとに「見出しを直す」「元に戻す」ができる）
      const made: MadeImage =
        kind === "screen" && shot
          ? { kind: "headline", photo: await bitmapToJpeg(shot.bitmap), photoAi: shot.aiJobId, settings: { size, photoFit, ...style, label, headline, subline, footer } }
          : { kind: "text" };
      if (await onAdd(jpeg, altText.slice(0, MAX_ALT_LENGTH), ai, made)) setAdded(true);
    } catch {
      setError("画像を作れませんでした。もう一度お試しください。");
    } finally {
      setAdding(false);
    }
  }

  function openPhoto() {
    setPhotoOpened(true);
    setMode("photo");
  }

  // AI で作った写真を、影も文字も重ねずにそのまま添える（その大きさのまま JPEG にする。AI の印は「そのまま」の trainedAlgorithmicMedia）
  async function addAsIs(bitmap: ImageBitmap, jobId: string, altText: string): Promise<boolean> {
    const c = document.createElement("canvas");
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext("2d")?.drawImage(bitmap, 0, 0);
    const jpeg = await canvasToJpeg(c);
    const ok = await onAdd(jpeg, altText, { jobId, source: "generated" }, { kind: "plain" });
    if (ok) setAdded(true);
    return ok;
  }

  async function addPhotoAsIs(photo: PickedPhoto, altText: string): Promise<boolean> {
    try {
      return await addAsIs(photo.bitmap, photo.jobId, altText);
    } finally {
      photo.bitmap.close();
    }
  }

  // 「見出しを重ねる」のあと、やっぱり見出しなしで添える（敷いている AI の写真をそのまま）
  async function addShotAsIs() {
    if (!shot?.aiJobId) return;
    setAdding(true);
    setError(null);
    try {
      await addAsIs(shot.bitmap, shot.aiJobId, `AI で作った画像。${shot.scene ?? ""}`.slice(0, MAX_ALT_LENGTH));
    } catch {
      setError("画像を添えられませんでした。もう一度お試しください。");
    } finally {
      setAdding(false);
    }
  }

  // AI で作った写真を「写真に見出し」に敷く
  function usePhotoInTemplate(photo: PickedPhoto) {
    setShot({ bitmap: photo.bitmap, name: `ai:${photo.jobId}:${photo.bitmap.width}`, aiJobId: photo.jobId, scene: photo.scene });
    // フォーマットに見出しの文があれば入れておく（まだ何も書いていないときだけ）
    if (preset?.headline) setHeadline((h) => h || preset.headline || "");
    // 見出しの上の小さい文（ラベル）も、フォーマットにあれば入れておく（まだ何も書いていないときだけ）
    if (preset?.label) setLabel((l) => l || preset.label || "");
    setKind("screen");
    setPhotoFit("cover");
    // 文字を入れる画面に移るだけ（覚えたつくり方は AI の写真のまま）
    setModeState("template");
  }

  const tall = kind !== "note" && size !== "landscape";
  const hasText = text.trim().length > 0;

  return (
    <section aria-labelledby="image-maker-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="image-maker-heading" className="text-[15px] font-bold">
          {nextIndex > 1 ? `${nextIndex} 枚目をつくる` : "画像をつくる"}
        </h3>
        {nextIndex > 1 && instagram && first && (
          <span className="text-xs text-muted">{`Instagram のカルーセルなら、1 枚目と同じ縦横（${TEMPLATE_SIZES[closestSize(first.width, first.height)].label}）にそろえます`}</span>
        )}
        <Button type="button" variant="text" size="sm" className="ml-auto" onClick={onClose}>
          {added ? "閉じる" : "やめる"}
        </Button>
      </div>

      {added && (
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface2 px-3.5 py-2 text-sm">
          <span>
            <span aria-hidden className="mr-1 font-bold text-success">
              ✓
            </span>
            添えました（画像は {nextIndex - 1} 枚）。続けて {nextIndex} 枚目をつくれます
          </span>
          {mode === "photo" && <span className="text-xs text-muted">絵の説明とフォーマットはそのまま。場面だけ変えると、同じ雰囲気でそろいます</span>}
        </p>
      )}

      {/* つくり方は 2 つを同じ大きさで並べ、何ができて費用がかかるかを 1 行で添える（AI の写真がテンプレートの横の小さなタブで見つけにくかった。指摘 18） */}
      <div role="group" aria-label="つくり方" className="grid grid-cols-2 gap-2">
        <ModeCard on={mode === "template"} onClick={() => setMode("template")} title="テンプレート" note="文字のカード・図解など（無料）" />
        <ModeCard on={mode === "photo"} onClick={openPhoto} title="AI で写真・絵" note={`絵の説明から AI がつくる（1 枚 約 ${photoUnitYen(photoModel({}))} 円）`} />
      </div>

      {photoOpened && (
        <div hidden={mode !== "photo"} className="flex flex-col gap-4">
          {mode === "photo" && error && <ErrorBanner>{error}</ErrorBanner>}
          <PhotoMaker projectId={projectId} targets={targets} visible={mode === "photo"} text={text} size={size} onSize={setSize} nextIndex={nextIndex} onUseAsIs={addPhotoAsIs} onUseInTemplate={usePhotoInTemplate} preset={preset} />
        </div>
      )}
      {mode === "template" && (
        <>
          {kind === "screen" && shot?.aiJobId && (
            <div className="flex flex-col items-start gap-2 rounded-md border border-line px-3.5 py-2.5 max-sm:px-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Button type="button" variant="text" size="sm" className="-ml-2" onClick={() => setMode("photo")}>
                  ← 候補に戻る
                </Button>
                <span className="text-xs text-muted">AI で作った画像に文字を入れています</span>
              </div>
              {/* スマホの幅では 2 行にする（1 行だと 320 幅で枠からはみ出す） */}
              <Button type="button" variant="secondary" size="sm" className="h-auto min-h-8 gap-0 py-1.5 max-sm:flex-col max-sm:items-start" disabled={adding} onClick={() => void addShotAsIs()}>
                <span>文字を入れずにそのまま使う</span>
                <span className="max-sm:text-xs max-sm:font-normal">（AI の画像を添える）</span>
              </Button>
            </div>
          )}
          <BriefBar aiEnabled={aiEnabled} hasText={hasText} drafting={drafting} brief={brief} onDraft={draft} />

          {error && <ErrorBanner>{error}</ErrorBanner>}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-[72px] lg:self-start lg:order-2">
              <div className="rounded-md border border-line bg-surface2 p-2">
                <canvas ref={canvasRef} aria-label="できあがりの見本" role="img" className={`mx-auto block h-auto w-full ${tall ? "max-w-[360px]" : ""}`} />
              </div>
              {kind === "screen" && shot?.aiJobId && (
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <AiBadge />
                  添えると、AI で作った画像の印が付きます
                </p>
              )}
              {renderError && <p className="text-xs text-danger">見本を描けませんでした。ページを読み込み直してください。</p>}
            </div>

            <div className="flex min-w-0 flex-col gap-4 lg:order-1">
              <Group label="種類" hint={TEMPLATE_KIND_HINT[kind]}>
                {TEMPLATE_KINDS.map((k) => (
                  <Choice key={k} on={kind === k} onClick={() => setKind(k)}>
                    {TEMPLATE_KIND_LABEL[k]}
                  </Choice>
                ))}
              </Group>

              {kind !== "note" && (
                <SizeField size={size} hint={size === suggested.size ? `おすすめ: ${suggested.reason}` : "どれも Instagram に送れる比率です"} onSize={setSize} />
              )}

              {kind === "screen" && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[14px] font-bold">写真</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => void pickShot(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
                    <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                      {shot ? "写真を選び直す" : "写真を選ぶ"}
                    </Button>
                    <Button type="button" variant="text" size="sm" onClick={openPhoto}>
                      AI でつくる
                    </Button>
                    {shot && <span className="text-xs text-muted">{shot.bitmap.width}×{shot.bitmap.height}</span>}
                  </div>
                  <p className="text-xs leading-[1.7] text-muted">選んだ写真は AI には送りません。添えるときは、あとで見出しを編集できるように元の写真も預かります（投稿に使わなければ 1 日で消えます）。{nextIndex > 1 && "添えた画像に見出しを付けるときは、その画像の行の「見出しを付ける」から付けられます。"}</p>
                </div>
              )}
              {kind === "screen" && (
                <PhotoFitField value={photoFit} onChange={setPhotoFit} />
              )}

              <LabelField value={label} onChange={setLabel} />

              {kind === "diagram" ? (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[14px] font-bold">図解のタイトル</span>
                    <Input value={diagramTitle} maxLength={40} onChange={(e) => setDiagramTitle(e.target.value)} className="py-2" />
                  </label>
                  <Group label="並べ方">
                    {DIAGRAM_STYLES.map((s) => (
                      <Choice key={s} on={diagramStyle === s} onClick={() => setDiagramStyle(s)}>
                        {DIAGRAM_STYLE_LABEL[s]}
                      </Choice>
                    ))}
                  </Group>
                  <ol className="flex flex-col gap-2.5">
                    {(diagramStyle === "compare" ? items.slice(0, 2) : items).map((it, i) => (
                      <li key={i} className="flex flex-col gap-1.5 rounded-md border border-line p-2.5">
                        <div className="flex items-center gap-2 text-xs font-bold">
                          {diagramStyle === "compare" ? (i === 0 ? "前" : "後") : `${i + 1} つ目`}
                          {diagramStyle !== "compare" && items.length > 1 && (
                            <button type="button" className="ml-auto font-normal text-muted hover:text-fg hover:underline" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>
                              外す
                            </button>
                          )}
                        </div>
                        <Input aria-label={`${i + 1} つ目の見出し`} placeholder="見出し（14 字まで）" value={it.title} maxLength={24} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} className="py-2" />
                        <Input aria-label={`${i + 1} つ目の説明`} placeholder="説明（36 字まで）" value={it.text} maxLength={60} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} className="py-2" />
                      </li>
                    ))}
                  </ol>
                  {diagramStyle === "compare" && items.length < 2 && (
                    <Button type="button" variant="text" size="sm" className="self-start" onClick={() => setItems((xs) => [...xs, { title: "", text: "" }])}>
                      ＋ 後を足す
                    </Button>
                  )}
                  {diagramStyle !== "compare" && items.length < MAX_ITEMS && (
                    <Button type="button" variant="text" size="sm" className="self-start" onClick={() => setItems((xs) => [...xs, { title: "", text: "" }])}>
                      ＋ 項目を足す
                    </Button>
                  )}
                </>
              ) : (
                <HeadlineFields headline={headline} subline={subline} brief={brief} onHeadline={setHeadline} onSubline={setSubline} />
              )}

              <FooterField value={footer} onChange={setFooter} />

              {/* 文字の置き方（文字のカード・note のヘッダー・写真を全面に敷く）。図解と端末の枠は、置き方が決まっている */}
              <StyleFields style={style} onStyle={setStyle} showTextStyle={kind === "card" || kind === "note" || (kind === "screen" && photoFit === "cover")} />

              <label className="flex flex-col gap-1.5">
                <span className="text-[14px] font-bold">画像の説明文</span>
                <Textarea
                  value={altText}
                  rows={2}
                  maxLength={MAX_ALT_LENGTH}
                  onChange={(e) => {
                    setAltTouched(true);
                    setAlt(e.target.value);
                  }}
                  className="py-2 text-sm"
                />
                <span className="text-xs text-muted">読み上げや、画像が出ないときに使われる文です。画像の文字から作っています。編集することもできます</span>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <Button type="button" disabled={Boolean(notReady) || adding || renderError} onClick={() => void add()}>
              {adding ? "添えています…" : `${nextIndex} 枚目として添える`}
            </Button>
            <Button type="button" variant="text" onClick={onClose}>
              {added ? "閉じる" : "やめる"}
            </Button>
            {notReady && <span className="text-sm text-muted">{notReady}</span>}
          </div>
        </>
      )}
    </section>
  );
}

// つくり方の選択（テンプレート／AI で写真・絵）。名前と、何ができて費用がかかるかの 1 行
function ModeCard({ on, onClick, title, note }: { on: boolean; onClick: () => void; title: string; note: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-w-0 flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors ${on ? "border-primary bg-primary-soft" : "border-border bg-surface hover:border-primary"}`}
    >
      <span className={`text-sm font-bold ${on ? "text-primary" : "text-fg"}`}>{title}</span>
      <span className="text-xs leading-[1.6] text-muted">{note}</span>
    </button>
  );
}
