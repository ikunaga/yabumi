"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import { draftImageText } from "@/lib/ai/image-brief-actions";
import type { ImageBrief } from "@/lib/ai/image-brief";
import { MAX_ALT_LENGTH } from "@/lib/media/rules";
import { FONT_CLASS, TEMPLATE_FONTS } from "@/lib/media/template-fonts";
import { canvasToJpeg, renderTemplate } from "@/lib/media/template-render";
import {
  DEFAULT_BRAND_COLOR,
  DIAGRAM_STYLES,
  DIAGRAM_STYLE_LABEL,
  FONT_KEYS,
  FONT_LABEL,
  MAX_ITEMS,
  PALETTES,
  TEMPLATE_KINDS,
  TEMPLATE_KIND_HINT,
  TEMPLATE_KIND_LABEL,
  TEMPLATE_SIZES,
  autoAlt,
  brandPalette,
  defaultSizeFor,
  templateReady,
  type DiagramStyle,
  type FontKey,
  type TemplateInput,
  type TemplateItem,
  type TemplateKind,
  type TemplateSizeKey,
} from "@/lib/media/templates";
import type { SnsKey } from "@/lib/sns";

export type ImageMakerProps = {
  projectId: string;
  projectName: string;
  aiEnabled: boolean;
  // 投稿の本文（AI が文字の案を考える材料）
  text: string;
  // いま選んでいる送り先（縦横比の既定を決める）
  targets: SnsKey[];
  onAdd: (jpeg: Blob, altText: string) => Promise<boolean>;
  onClose: () => void;
};

type Saved = { palette: string; brand: string; font: FontKey };
const storageKey = (projectId: string) => `yabumi-template:${projectId}`;

function loadSaved(projectId: string): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? "null");
    return v && typeof v.palette === "string" && typeof v.brand === "string" && FONT_KEYS.includes(v.font) ? v : null;
  } catch {
    return null;
  }
}

function Choice({ on, onClick, children, className = "" }: { on: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${on ? "border-primary bg-primary-soft font-bold text-primary" : "border-border bg-surface text-fg hover:border-primary"} ${className}`}
    >
      {children}
    </button>
  );
}

function Group({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 text-[14px] font-bold">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint && <p className="text-xs leading-[1.7] text-muted">{hint}</p>}
    </fieldset>
  );
}

// テンプレートで画像をつくる（F14 の段取り ①。docs/architecture.md の 4.25）。
// ブラウザの Canvas で描き、できた JPEG を画像の添付（4.18）と同じ流れで上げる。画面の画像（スクリーンショット）はどこにも送らない
export function ImageMaker({ projectId, projectName, aiEnabled, text, targets, onAdd, onClose }: ImageMakerProps) {
  const suggested = useMemo(() => defaultSizeFor(targets), [targets]);
  const [kind, setKind] = useState<TemplateKind>(targets.length === 1 && targets[0] === "note" ? "note" : "card");
  const [size, setSize] = useState<TemplateSizeKey>(suggested.size);
  // 色と書体は、プロジェクトごとに前回のものを覚えておく（この端末だけ。この画面はブラウザでだけ描くので、最初から読める）
  const [saved] = useState(() => loadSaved(projectId));
  const [paletteKey, setPaletteKey] = useState(saved?.palette ?? PALETTES[0].key);
  const [brand, setBrand] = useState(saved?.brand ?? DEFAULT_BRAND_COLOR);
  const [font, setFont] = useState<FontKey>(saved?.font ?? "gothic");
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
  const [shot, setShot] = useState<{ bitmap: ImageBitmap; name: string } | null>(null);
  const [alt, setAlt] = useState("");
  const [altTouched, setAltTouched] = useState(false);
  const [brief, setBrief] = useState<ImageBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [adding, setAdding] = useState(false);
  const [drafting, startDraft] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify({ palette: paletteKey, brand, font } satisfies Saved));
    } catch {
      // 保存できなくても描くのは続ける
    }
  }, [projectId, paletteKey, brand, font]);

  // 閉じたら画面の画像を手放す
  useEffect(() => () => shot?.bitmap.close(), [shot]);

  const palette = paletteKey === "brand" ? brandPalette(brand) : (PALETTES.find((p) => p.key === paletteKey) ?? PALETTES[0]);
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
  }, [inputKey]);

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
      const res = await draftImageText(projectId, text);
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

  async function add() {
    const canvas = canvasRef.current;
    if (!canvas || notReady) return;
    setAdding(true);
    setError(null);
    try {
      const jpeg = await canvasToJpeg(canvas);
      if (await onAdd(jpeg, altText.slice(0, MAX_ALT_LENGTH))) onClose();
    } catch {
      setError("画像を作れませんでした。もう一度お試しください。");
    } finally {
      setAdding(false);
    }
  }

  const tall = kind !== "note" && size !== "landscape";
  const hasText = text.trim().length > 0;

  return (
    <section aria-labelledby="image-maker-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id="image-maker-heading" className="text-[15px] font-bold">
          画像をつくる
        </h3>
        <span className="text-xs text-muted">テンプレートに文字を入れて作ります。画像の費用はかかりません</span>
        <Button type="button" variant="text" size="sm" className="ml-auto" onClick={onClose}>
          やめる
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-md bg-surface2 px-3.5 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {aiEnabled ? (
            <Button type="button" variant="secondary" size="sm" disabled={drafting || !hasText} onClick={draft}>
              {drafting ? "考えています…" : brief ? "別の案を出してもらう" : "AI に文字の案を出してもらう"}
            </Button>
          ) : (
            <NotReadyButton variant="secondary" size="sm">
              AI に文字の案を出してもらう
            </NotReadyButton>
          )}
          <span className="text-xs text-muted">{hasText ? "本文とアカウント設計から考えます（1 回 2 円ほど）" : "本文を書くと、AI が画像の文字を考えます"}</span>
        </div>
        {brief && (
          <p className="leading-[1.7]">
            <span className="mr-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-bold text-primary">AI のおすすめ</span>
            {TEMPLATE_KIND_LABEL[brief.recommend]}。{brief.reason}
          </p>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4 lg:self-start lg:order-2">
          <div className="rounded-md border border-line bg-surface2 p-2">
            <canvas ref={canvasRef} aria-label="できあがりの見本" role="img" className={`mx-auto block h-auto w-full ${tall ? "max-w-[360px]" : ""}`} />
          </div>
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
            <Group label="縦横" hint={size === suggested.size ? `おすすめ: ${suggested.reason}` : "どれも Instagram に送れる比率です"}>
              {(Object.keys(TEMPLATE_SIZES) as TemplateSizeKey[]).map((s) => (
                <Choice key={s} on={size === s} onClick={() => setSize(s)}>
                  {TEMPLATE_SIZES[s].label}
                </Choice>
              ))}
            </Group>
          )}

          {kind === "screen" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[14px] font-bold">アプリの画面</span>
              <div className="flex flex-wrap items-center gap-2">
                <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => void pickShot(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  {shot ? "画面の画像を選び直す" : "画面の画像を選ぶ"}
                </Button>
                {shot && <span className="text-xs text-muted">{shot.bitmap.width}×{shot.bitmap.height}</span>}
              </div>
              <p className="text-xs leading-[1.7] text-muted">スクリーンショットは、この画面の中で重ねるだけで、AI には送りません。本物の画面を使ってください。</p>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">
              ラベル<span className="ml-1.5 text-xs font-normal text-muted">任意。例: 新機能、お知らせ</span>
            </span>
            <Input value={label} maxLength={12} onChange={(e) => setLabel(e.target.value)} className="py-2" />
          </label>

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
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[14px] font-bold">見出し</span>
                <Textarea value={headline} rows={2} maxLength={40} onChange={(e) => setHeadline(e.target.value)} className="py-2" />
                <span className="text-xs text-muted">22 字くらいまでが、ひと目で読めます。改行も使えます</span>
              </label>
              {brief && brief.headlines.length > 1 && (
                <Group label="AI の見出しの案">
                  {brief.headlines.map((h) => (
                    <Choice key={h} on={headline === h} onClick={() => setHeadline(h)} className="text-left">
                      {h}
                    </Choice>
                  ))}
                </Group>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="text-[14px] font-bold">
                  補足<span className="ml-1.5 text-xs font-normal text-muted">任意</span>
                </span>
                <Input value={subline} maxLength={60} onChange={(e) => setSubline(e.target.value)} className="py-2" />
              </label>
            </>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">
              下に小さく出す名前<span className="ml-1.5 text-xs font-normal text-muted">任意</span>
            </span>
            <Input value={footer} maxLength={30} onChange={(e) => setFooter(e.target.value)} className="py-2" />
          </label>

          <Group label="色">
            {PALETTES.map((p) => (
              <Choice key={p.key} on={paletteKey === p.key} onClick={() => setPaletteKey(p.key)} className="inline-flex items-center gap-1.5">
                {/* 画像の中身の色の見本（画面の色ではない） */}
                <span aria-hidden className="inline-block size-4 rounded-full border border-line" style={{ background: `linear-gradient(135deg, ${p.bg} 55%, ${p.accent} 55%)` }} />
                {p.label}
              </Choice>
            ))}
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${paletteKey === "brand" ? "border-primary bg-primary-soft font-bold text-primary" : "border-border"}`}>
              <input
                type="color"
                aria-label="アプリの色を選ぶ"
                value={brand}
                onChange={(e) => {
                  setBrand(e.target.value);
                  setPaletteKey("brand");
                }}
                className="size-6 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <button type="button" aria-pressed={paletteKey === "brand"} onClick={() => setPaletteKey("brand")}>
                アプリの色
              </button>
            </span>
          </Group>

          <Group label="文字の形" hint="日本語の書体は、使う字のぶんだけ読み込みます">
            {FONT_KEYS.map((f) => (
              <Choice key={f} on={font === f} onClick={() => setFont(f)} className={FONT_CLASS[f]}>
                {FONT_LABEL[f]}
              </Choice>
            ))}
          </Group>

          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-bold">代わりの文（alt）</span>
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
            <span className="text-xs text-muted">画像の文字から作っています。直すこともできます</span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button type="button" disabled={Boolean(notReady) || adding || renderError} onClick={() => void add()}>
          {adding ? "添えています…" : "この画像を添える"}
        </Button>
        <Button type="button" variant="text" onClick={onClose}>
          やめる
        </Button>
        {notReady && <span className="text-sm text-muted">{notReady}</span>}
      </div>
    </section>
  );
}
