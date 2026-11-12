"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { draftImageText } from "@/lib/ai/image-brief-actions";
import type { ImageBrief } from "@/lib/ai/image-brief";
import { headlineInput, initialHeadline, type HeadlineSettings } from "@/lib/media/headline";
import { TEMPLATE_FONTS } from "@/lib/media/template-fonts";
import { canvasToJpeg, renderTemplate } from "@/lib/media/template-render";
import { templateReady } from "@/lib/media/templates";
import type { SnsKey } from "@/lib/sns";
import { loadBitmap } from "./aspect-options";
import { AiBadge } from "./ai-badge";
import { BriefBar, FooterField, HeadlineFields, LabelField, PhotoFitField, SizeField, StyleFields, useTemplateStyle } from "./template-fields";

// 添えた画像に見出しを付ける・直す（4.58）。「写真に見出し」と同じ描き方で、添えた写真を敷いて見出しを重ねる。
// ブラウザーの中だけで描き、できた JPEG を 4.18 の流れで上げて差し替える（縦横を整える・調整すると同じ。元の画像は残り、元に戻せる）
export function ImageHeadlineEditor({
  source,
  initial,
  unknown,
  ai,
  index,
  projectId,
  projectName,
  aiEnabled,
  text,
  targets,
  onApply,
  onClose,
}: {
  // 見出しを重ねる写真（前に見出しを付けていれば、その前の写真。見出しを重ねて描かないため）
  source: { previewUrl: string; width: number; height: number };
  // 前に見出しを付けたときの設定（「見出しを直す」）
  initial?: HeadlineSettings;
  // 保存して開き直した画像（文字が入っているかわからない）
  unknown: boolean;
  // AI で作った画像か（差し替えると、手を加えた AI の画像の印が付く）
  ai: boolean;
  index: number;
  projectId: string;
  projectName: string;
  aiEnabled: boolean;
  text: string;
  targets: SnsKey[];
  onApply: (jpeg: Blob, settings: HeadlineSettings) => Promise<boolean>;
  onClose: () => void;
}) {
  const [style, setStyle] = useTemplateStyle(projectId, initial && { palette: initial.palette, brand: initial.brand, font: initial.font, textStyle: initial.textStyle });
  const [s, setS] = useState<HeadlineSettings>(() => initial ?? initialHeadline(source, projectName));
  const set = (patch: Partial<HeadlineSettings>) => setS((x) => ({ ...x, ...patch }));
  const settings: HeadlineSettings = { ...s, ...style };
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [brief, setBrief] = useState<ImageBrief | null>(null);
  const [drafting, startDraft] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    let loaded: ImageBitmap | null = null;
    loadBitmap(source.previewUrl)
      .then((b) => {
        loaded = b;
        if (alive) setBitmap(b);
        else b.close();
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
      loaded?.close();
    };
  }, [source.previewUrl]);

  const input = headlineInput(settings, TEMPLATE_FONTS[style.font], source);
  const notReady = templateReady(input);

  // 設定が変わるたびに描き直す（書体の読み込みを待つので、古い描画があとから上書きしないよう番号で確かめる）
  const drawSeq = useRef(0);
  const inputKey = JSON.stringify(settings);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return;
    const seq = ++drawSeq.current;
    const off = document.createElement("canvas");
    renderTemplate(off, input, bitmap)
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
  }, [inputKey, bitmap]);

  function draft() {
    startDraft(async () => {
      setError(null);
      const res = await draftImageText(projectId, text, targets);
      if (res.error || !res.brief) {
        setError(res.error ?? "うまくいきませんでした。");
        return;
      }
      setBrief(res.brief);
      set({ label: res.brief.label, headline: res.brief.headlines[0] ?? "", subline: res.brief.subline });
    });
  }

  async function apply() {
    const canvas = canvasRef.current;
    if (!canvas || notReady) return;
    setBusy(true);
    setError(null);
    try {
      if (await onApply(await canvasToJpeg(canvas), settings)) onClose();
    } catch {
      setError("画像を作れませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  const tall = s.size !== "landscape";

  return (
    <section aria-label={`${index + 1} 枚目に見出しを付ける`} className="mt-1 flex flex-col gap-4 rounded-md border border-line bg-surface p-3.5 max-sm:p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className="text-sm font-bold">{initial ? "見出しを直す" : "見出しを付ける"}</h4>
        <span className="text-xs text-muted">{initial ? "見出しのない元の写真から描き直します" : "写真に見出しを重ねて、この画像と差し替えます。元に戻すこともできます"}</span>
      </div>

      <BriefBar aiEnabled={aiEnabled} hasText={text.trim().length > 0} drafting={drafting} brief={brief} onDraft={draft} />
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-[72px] lg:self-start lg:order-2">
          <div className="rounded-md border border-line bg-surface2 p-2">
            {loadError ? (
              <p className="p-4 text-sm text-danger">画像を読み込めませんでした。ページを読み込み直してください。</p>
            ) : (
              <canvas ref={canvasRef} aria-label="できあがりの見本" role="img" className={`mx-auto block h-auto w-full ${tall ? "max-w-[360px]" : ""}`} />
            )}
          </div>
          {unknown && <p className="text-xs leading-[1.7] text-muted">文字が入った画像だと、見出しが重なります</p>}
          {ai && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <AiBadge />
              差し替えても、AI で作った画像の印は付いたままです
            </p>
          )}
          {renderError && <p className="text-xs text-danger">見本を描けませんでした。ページを読み込み直してください。</p>}
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:order-1">
          <HeadlineFields headline={s.headline} subline={s.subline} brief={brief} onHeadline={(headline) => set({ headline })} onSubline={(subline) => set({ subline })} />
          <LabelField value={s.label} onChange={(label) => set({ label })} />
          <FooterField value={s.footer} onChange={(footer) => set({ footer })} />
          <PhotoFitField value={s.photoFit} onChange={(photoFit) => set({ photoFit })} />
          <SizeField size={s.size} onSize={(size) => set({ size })} />
          <StyleFields style={style} onStyle={setStyle} showTextStyle={s.photoFit === "cover"} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button type="button" disabled={Boolean(notReady) || busy || !bitmap || renderError} onClick={() => void apply()}>
          {busy ? "差し替えています…" : initial ? "見出しを直して差し替える" : "見出しを付けて差し替える"}
        </Button>
        <Button type="button" variant="text" onClick={onClose}>
          やめる
        </Button>
        {notReady && <span className="text-sm text-muted">{notReady}</span>}
      </div>
    </section>
  );
}
