"use client";

import type { SnsKey } from "@/lib/sns";
import { useEffect, useState, useTransition } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Input, Textarea } from "@/components/ui/field";
import { acknowledgePhoto, draftPhotoIdeas, generatePhotos, photoPanelState, refreshPhotoCandidates, type PhotoPanelState } from "@/lib/ai/photo-actions";
import { MAX_PHOTOS_PER_RUN, MAX_SCENE_CHARS, PHOTO_LIMITS, PHOTO_STYLES, PHOTO_STYLE_LABEL, type PhotoIdea, type PhotoStyle } from "@/lib/ai/photo";
import type { PhotoCandidate } from "@/lib/ai/photo-gen";
import { MAX_ALT_LENGTH, PREVIEW_URL_SECONDS } from "@/lib/media/rules";
import { TEMPLATE_SIZES, type TemplateSizeKey } from "@/lib/media/templates";
import { AiBadge } from "./ai-badge";
import { Choice, Group } from "./maker-parts";
import { PhotoTemplatePicker, SaveAsTemplate } from "./photo-templates";
import { listPhotoTemplates, type TemplatesResult } from "@/lib/photo-templates/actions";
import { SCENE_SLOT, fillTemplate, hasSceneSlot, type PhotoTemplate } from "@/lib/photo-templates/schema";

export type PickedPhoto = { jobId: string; bitmap: ImageBitmap; scene: string };

// 候補の表示の URL は 1 時間で切れる。切れる 5 分前からは、使う前・候補に戻ったときに作り直す
const STALE_AFTER_MS = (PREVIEW_URL_SECONDS - 5 * 60) * 1000;
type Candidates = { jobId: string; items: PhotoCandidate[]; scene: string; signedAt: number };


// 署名つきの URL から画像を読む（fetch で読むので、Canvas に描いても書き出せる）
async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("load");
  return createImageBitmap(await res.blob());
}

// AI で写真・絵をつくる（docs/architecture.md の 4.25 の ②、決定 D35）。
// ① 絵の説明を AI（Claude）に案を出してもらうか手で書く → ② 画像の AI で 1〜2 枚 → ③ 選んでそのまま添えるか、見出しを重ねる。
// 「テンプレート」のタブに切り替えても外さずに隠すだけなので、作った候補・選んだ候補・絵の説明は残る（visible は隠しているか）
export function PhotoMaker({
  projectId,
  targets,
  visible,
  text,
  size,
  onSize,
  nextIndex,
  onUseAsIs,
  onUseInTemplate,
}: {
  projectId: string;
  // 送り先の SNS（絵の説明の案の材料にする投稿の柱を、この SNS に付いたものにする）
  targets: SnsKey[];
  visible: boolean;
  text: string;
  size: TemplateSizeKey;
  onSize: (s: TemplateSizeKey) => void;
  // 次に添えるのは何枚目か（ボタンの「2 枚目として添える」）
  nextIndex: number;
  // 添えられたら true
  onUseAsIs: (photo: PickedPhoto, altText: string) => Promise<boolean>;
  onUseInTemplate: (photo: PickedPhoto) => void;
}) {
  const [state, setState] = useState<PhotoPanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<PhotoIdea[]>([]);
  const [scene, setScene] = useState("");
  const [style, setStyle] = useState<PhotoStyle>("photo");
  const [count, setCount] = useState(2);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  // 選んだ候補（まとめて添えられる）と、もう添えた候補（同じ候補を 2 回添えない）
  const [picked, setPicked] = useState<string[]>([]);
  const [usedPaths, setUsedPaths] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [using, setUsing] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [making, startMake] = useTransition();
  const [acking, startAck] = useTransition();
  // 絵の説明のフォーマット（「いつも使う」をはじめから選ぶ）。lastIdea: 最後に選んだ AI の案の場面（フォーマットを替えたときに差し込み直す）
  const [templates, setTemplates] = useState<PhotoTemplate[]>([]);
  const [examples, setExamples] = useState<{ name: string; body: string }[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [lastIdea, setLastIdea] = useState("");

  useEffect(() => {
    let alive = true;
    void photoPanelState().then((r) => {
      if (!alive) return;
      if (r.state) setState(r.state);
      else setError(r.error ?? "読み込めませんでした。");
    });
    void listPhotoTemplates(projectId).then((r) => {
      if (!alive || !r.templates) return;
      setTemplates(r.templates);
      setExamples(r.examples ?? []);
      // 「いつも使う」をはじめから選び、まだ何も書いていなければ、その本文を絵の説明に入れる（{場面} は穴のまま）
      const d = r.templates.find((t) => t.isDefault) ?? null;
      setTemplateId(d?.id ?? null);
      if (d) setScene((cur) => (cur.trim() ? cur : d.body));
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const template = templates.find((t) => t.id === templateId) ?? null;

  // 操作のあとの一覧に入れ替える（選んでいたものが消えたら「なし」に）
  function onTemplates(r: TemplatesResult) {
    if (r.error) {
      setError(r.error);
      return;
    }
    setError(null);
    setTemplates(r.templates ?? []);
    if (r.examples) setExamples(r.examples);
    if (templateId && !r.templates?.some((t) => t.id === templateId)) setTemplateId(null);
  }

  // フォーマットを選ぶと、その本文を絵の説明に入れる（{場面} には、最後に選んだ AI の案の場面を差し込む）
  function selectTemplate(t: PhotoTemplate | null) {
    setTemplateId(t?.id ?? null);
    // 案をまだ選んでいなければ、{場面} は穴のまま入れる（書き換えるまで作れない）
    if (t) setScene(lastIdea || !hasSceneSlot(t.body) ? fillTemplate(t.body, lastIdea) : t.body);
    else if (lastIdea) setScene(lastIdea);
  }

  function pickIdea(ideaScene: string) {
    setLastIdea(ideaScene);
    setScene(template ? fillTemplate(template.body, ideaScene) : ideaScene);
  }

  // 候補に戻ってきたとき、表示の URL が切れかけていれば作り直す
  useEffect(() => {
    if (visible && candidates && Date.now() - candidates.signedAt > STALE_AFTER_MS) void freshItems();
    // freshItems は candidates から作る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 候補の URL を、切れかけていれば作り直して返す（force: 画像が読めなかったとき。作り直して 30 秒以内なら繰り返さない）。
  // 候補が消えていたら（1 日たった）候補を外して知らせる
  async function freshItems(force = false): Promise<PhotoCandidate[] | null> {
    if (!candidates) return null;
    if (!force && Date.now() - candidates.signedAt <= STALE_AFTER_MS) return candidates.items;
    const r = await refreshPhotoCandidates({ jobId: candidates.jobId, paths: candidates.items.map((c) => c.path) });
    if (!r.urls) {
      setCandidates(null);
      setPicked([]);
      setError(r.error ?? "候補を読み直せませんでした。");
      return null;
    }
    const byPath = new Map(r.urls.map((u) => [u.path, u.url]));
    const items = candidates.items.map((c) => ({ ...c, url: byPath.get(c.path) ?? c.url }));
    setCandidates({ ...candidates, items, signedAt: Date.now() });
    return items;
  }

  if (!state) return error ? <ErrorBanner>{error}</ErrorBanner> : <p className="text-sm text-muted">読み込んでいます…</p>;

  // 鍵（GEMINI_API_KEY）がない間は、注意も絵の説明の案も出さない（規約・ポリシーの施行の前に、新しい使い道の情報を預からない・送らない）
  if (!state.enabled) {
    return <p className="rounded-md border border-dashed border-line px-4 py-3.5 text-sm text-muted">AI で写真・絵をつくる機能は準備中です。</p>;
  }

  if (!state.acknowledged) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-line bg-surface2 px-4 py-3.5 text-sm leading-[1.8]">
        <p className="font-bold">AI でつくる画像について（はじめの 1 回だけ出します）</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>作った画像には「AI で作った画像」の印を付けます（この画面の札と、画像の中の情報）。</li>
          <li>実在の人に似せたり、自分の商品・お店・顧客を本物の写真のように見せたりすると、見た人の誤解を招いたり、景品表示法（実際よりよく見せる表示）の問題になったりすることがあります。</li>
          <li>Instagram・Facebook・Threads などは、写真のような AI の画像に「AI で作った」ことの表示を求めています。投稿するときは、各 SNS の AI の表示も付けてください。</li>
          <li>絵の説明は、画像をつくる Google に送ります（学習には使われません）。何をつくるかと使い方は、あなたの責任になります。</li>
        </ul>
        {error && <ErrorBanner>{error}</ErrorBanner>}
        <Button
          type="button"
          size="sm"
          className="self-start"
          disabled={acking}
          onClick={() =>
            startAck(async () => {
              const r = await acknowledgePhoto();
              if (r.error) setError(r.error);
              else setState({ ...state, acknowledged: true });
            })
          }
        >
          わかりました
        </Button>
      </div>
    );
  }

  const hasText = text.trim().length > 0;
  const canMake = state.enabled && !state.globalReached && !state.newUsersFull && state.remainingImages > 0;
  const n = Math.min(count, Math.max(1, state.remainingImages));
  const pickedItems = candidates?.items.filter((c) => picked.includes(c.path)) ?? [];
  const remainingCandidates = candidates?.items.filter((c) => !usedPaths.includes(c.path)) ?? [];
  // {場面} のあるフォーマットを選んでいれば、場面だけを書き換える欄を出す（2 枚目から、同じ雰囲気で場面だけ変える）
  const slotTemplate = template && hasSceneSlot(template.body) ? template : null;

  function draft() {
    startDraft(async () => {
      setError(null);
      const r = await draftPhotoIdeas(projectId, text, targets, templateId);
      if (!r.ideas) {
        setError(r.error ?? "うまくいきませんでした。");
        return;
      }
      setIdeas(r.ideas);
      pickIdea(r.ideas[0].scene);
    });
  }

  function make() {
    startMake(async () => {
      setError(null);
      setNotice(null);
      const r = await generatePhotos({ projectId, scene, style, size, count: n });
      if (state && r.remainingImages !== undefined) setState({ ...state, remainingImages: r.remainingImages });
      if (!r.candidates || !r.jobId) {
        setError(r.error ?? "画像をつくれませんでした。");
        return;
      }
      setCandidates({ jobId: r.jobId, items: r.candidates, scene, signedAt: Date.now() });
      setPicked(r.candidates[0] ? [r.candidates[0].path] : []);
      setUsedPaths([]);
      if (r.partial) setNotice("頼んだうちの一部だけできました（できなかった分は数えません）。");
    });
  }

  // asIs: 選んだ候補を、選んだ順にそのまま添える（何枚でも）。見出しを重ねるのは 1 枚だけ
  async function use(asIs: boolean) {
    if (pickedItems.length === 0 || !candidates) return;
    setUsing(true);
    setError(null);
    try {
      const items = await freshItems();
      for (const path of picked) {
        const item = items?.find((c) => c.path === path);
        if (!item) continue;
        const bitmap = await loadBitmap(item.url);
        const photo = { jobId: candidates.jobId, bitmap, scene: candidates.scene };
        if (!asIs) {
          onUseInTemplate(photo);
          return;
        }
        if (!(await onUseAsIs(photo, `AI で作った画像。${candidates.scene}`.slice(0, MAX_ALT_LENGTH)))) break;
        setUsedPaths((u) => [...u, path]);
        setPicked((p) => p.filter((x) => x !== path));
      }
    } catch {
      setError("画像を読めませんでした。候補は 1 時間で見られなくなります。もう一度つくってください。");
    } finally {
      setUsing(false);
    }
  }

  function togglePick(path: string) {
    setPicked((p) => (p.includes(path) ? p.filter((x) => x !== path) : [...p, path]));
  }

  // {場面} を書き換えないまま作らない（画像の AI に穴のまま送らない）
  const slotLeft = hasSceneSlot(scene);

  return (
    <div className="flex flex-col gap-4">
      <PhotoTemplatePicker projectId={projectId} templates={templates} examples={examples} selectedId={templateId} onSelect={selectTemplate} onChange={onTemplates} />

      <div className="flex flex-col gap-2 rounded-md bg-surface2 px-3.5 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {state.ideasEnabled ? (
            <Button type="button" variant="secondary" size="sm" disabled={drafting || !hasText} onClick={draft}>
              {drafting ? "考えています…" : ideas.length ? "別の案を出してもらう" : "AI に絵の説明の案を出してもらう"}
            </Button>
          ) : (
            <NotReadyButton variant="secondary" size="sm">
              AI に絵の説明の案を出してもらう
            </NotReadyButton>
          )}
          <span className="text-xs text-muted">
            {hasText ? `本文とアカウント設計${template ? "・フォーマット" : ""}から 2〜3 案（1 回 2 円ほど）` : "本文を書くと、AI が場面を考えます。手で書いても作れます"}
          </span>
        </div>
        {drafting && <AiThinking kind="scene" note="10〜20 秒ほどかかります" />}
        {ideas.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="絵の説明の案">
            {ideas.map((idea) => (
              <li key={idea.scene}>
                <button
                  type="button"
                  aria-pressed={lastIdea === idea.scene}
                  onClick={() => pickIdea(idea.scene)}
                  className={`flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors ${lastIdea === idea.scene ? "border-primary bg-primary-soft" : "border-border bg-surface hover:border-primary"}`}
                >
                  <span className="font-bold">{idea.title}</span>
                  <span className="text-xs leading-[1.7] text-muted">{idea.why}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <label className="flex flex-col gap-1.5">
        <span className="text-[14px] font-bold">絵の説明</span>
        <Textarea value={scene} rows={4} maxLength={MAX_SCENE_CHARS} onChange={(e) => setScene(e.target.value)} placeholder="例: 朝の光が入る木のカウンターに、焼きたてのパンが並んでいる。近くから少し斜めに" className="py-2 text-sm" />
        <span className={`text-xs ${slotLeft ? "font-bold text-signal" : "text-muted"}`}>
          {slotLeft ? `${SCENE_SLOT} を、写したいもの（例: 焼きたてのパンが並んだカウンター）に書き換えてください` : "何が・どこで・どんな光と雰囲気か。文字は入れずに作り、見出しはあとで重ねられます"}
        </span>
      </label>
      {slotTemplate && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-bold">
            場面だけ変える<span className="ml-1.5 text-xs font-normal text-muted">フォーマット「{slotTemplate.name}」の {SCENE_SLOT} に入ります</span>
          </span>
          <Input
            value={lastIdea}
            maxLength={MAX_SCENE_CHARS}
            onChange={(e) => {
              setLastIdea(e.target.value);
              setScene(fillTemplate(slotTemplate.body, e.target.value) || slotTemplate.body);
            }}
            placeholder="例: 紙袋からのぞくカンパーニュ"
            className="py-2 text-sm"
          />
        </label>
      )}
      <SaveAsTemplate projectId={projectId} body={scene} disabled={!scene.trim()} onSaved={onTemplates} />

      <Group label="描き方">
        {PHOTO_STYLES.map((s) => (
          <Choice key={s} on={style === s} onClick={() => setStyle(s)}>
            {PHOTO_STYLE_LABEL[s]}
          </Choice>
        ))}
      </Group>
      <Group label="縦横">
        {(Object.keys(TEMPLATE_SIZES) as TemplateSizeKey[]).map((s) => (
          <Choice key={s} on={size === s} onClick={() => onSize(s)}>
            {TEMPLATE_SIZES[s].label}
          </Choice>
        ))}
      </Group>
      <Group label="枚数">
        {Array.from({ length: MAX_PHOTOS_PER_RUN }, (_, i) => i + 1).map((c) => (
          <Choice key={c} on={count === c} onClick={() => setCount(c)}>
            {c} 枚
          </Choice>
        ))}
      </Group>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {state.enabled ? (
          <Button type="button" disabled={!canMake || making || !scene.trim() || slotLeft} onClick={make}>
            {making ? "つくっています…" : `つくる（${n} 枚・約 ${n * state.unitYen} 円）`}
          </Button>
        ) : (
          <NotReadyButton>つくる</NotReadyButton>
        )}
        <span className="num text-sm text-muted">
          {state.globalReached
            ? "今月は yabumi 全体の上限に達しました。来月 1 日にまたつくれます"
            : state.newUsersFull
              ? `登録して ${PHOTO_LIMITS.newUserDays} 日までの方が使える今月の枠が、いっぱいになりました。${state.newUntil} からつくれます`
              : state.remainingImages > 0
                ? state.newUntil
                  ? `今月はあと ${state.remainingImages} 枚つくれます（登録して ${PHOTO_LIMITS.newUserDays} 日までは月 ${state.monthlyImages} 枚です。${state.newUntil} から ${PHOTO_LIMITS.userMonthlyImages} 枚になります）`
                  : `今月はあと ${state.remainingImages} 枚つくれます（1 人 月 ${state.monthlyImages} 枚まで）`
                : state.newUntil
                  ? `登録して ${PHOTO_LIMITS.newUserDays} 日までは月 ${state.monthlyImages} 枚です。${state.newUntil} から ${PHOTO_LIMITS.userMonthlyImages} 枚になります`
                  : `今月の上限（${state.monthlyImages} 枚）に達しました。来月 1 日にまたつくれます`}
        </span>
      </div>
      {making && <AiThinking kind="photo" note="30 秒ほどかかることがあります" />}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      {candidates && candidates.items.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <span className="text-[14px] font-bold">
            できた画像から選ぶ<span className="ml-1.5 text-xs font-normal text-muted">いくつでも選べます</span>
          </span>
          <ul className="grid grid-cols-2 gap-3 max-sm:gap-2">
            {candidates.items.map((c, i) => {
              const used = usedPaths.includes(c.path);
              const on = picked.includes(c.path);
              return (
                <li key={c.path}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={used}
                    aria-label={used ? `${i + 1} 枚目の候補（添えました）` : `${i + 1} 枚目の候補を選ぶ`}
                    onClick={() => togglePick(c.path)}
                    className={`relative block w-full overflow-hidden rounded-md border-2 ${on ? "border-primary" : "border-transparent"} ${used ? "opacity-50" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 署名つきの URL は期限があり、next/image の最適化を通さない */}
                    <img src={c.url} alt={`AI で作った画像の候補 ${i + 1}`} onError={() => candidates && Date.now() - candidates.signedAt > 30_000 && void freshItems(true)} className="block h-auto w-full bg-surface2" />
                    <AiBadge className="absolute left-2 top-2" />
                    {(on || used) && (
                      <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-primary">{used ? "✓ 添えました" : "✓ 選択"}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={pickedItems.length !== 1 || using} onClick={() => void use(false)}>
              見出しを重ねる
            </Button>
            <Button type="button" variant="secondary" disabled={pickedItems.length === 0 || using} onClick={() => void use(true)}>
              {using
                ? "添えています…"
                : pickedItems.length > 1
                  ? `選んだ ${pickedItems.length} 枚を添える（${nextIndex}〜${nextIndex + pickedItems.length - 1} 枚目）`
                  : `このまま添える（${nextIndex} 枚目）`}
            </Button>
          </div>
          <p className="text-xs leading-[1.7] text-muted">
            {/* 見出しを重ねるが押せない理由（添えた画像には、その画像の行の「見出しを付ける」から付けられる。4.58） */}
            {remainingCandidates.length === 0
              ? "候補はすべて添えました。見出しは、下の添えた画像の行の「見出しを付ける」から付けられます。続けてつくるときは、場面を変えて「つくる」を押してください。"
              : `${pickedItems.length === 0 ? "見出しを重ねるときは、候補を 1 枚選んでください。" : pickedItems.length > 1 ? "見出しを重ねるのは 1 枚ずつです。" : ""}選ばなかった画像は 1 日で消えます。`}
          </p>
        </div>
      )}
    </div>
  );
}
