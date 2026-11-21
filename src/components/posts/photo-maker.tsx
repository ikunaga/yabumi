"use client";

import type { SnsKey } from "@/lib/sns";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AiThinking } from "@/components/ui/ai-thinking";
import { DisclosureBox } from "@/components/ui/disclosure";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner } from "@/components/ui/feedback";
import { Textarea } from "@/components/ui/field";
import { acknowledgePhoto, draftFormatPhotoScene, draftPhotoIdeas, generatePhotos, listRecentScenes, photoPanelState, refreshPhotoCandidates, type PhotoPanelState } from "@/lib/ai/photo-actions";
import { AI_ALT_PREFIX, MAX_PHOTOS_PER_RUN, MAX_SCENE_CHARS, PHOTO_LIMITS, PHOTO_STYLES, PHOTO_STYLE_LABEL, SCENE_YEN, type PhotoIdea, type PhotoStyle } from "@/lib/ai/photo";
import type { PhotoCandidate } from "@/lib/ai/photo-gen";
import { MAX_ALT_LENGTH, PREVIEW_URL_SECONDS } from "@/lib/media/rules";
import { TEMPLATE_SIZES, type TemplateSizeKey } from "@/lib/media/templates";
import { AiBadge } from "./ai-badge";
import { Choice, Group } from "./maker-parts";
import type { FormatPhotoPreset } from "@/lib/post-formats/image";

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
  preset = null,
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
  // 投稿のフォーマットの画像（docs/design/format-image.md の 2.1）。seq が変わるたびに、絵の説明・描き方を入れ直し、auto なら 1 枚つくる
  preset?: FormatPhotoPreset | null;
}) {
  const sceneId = useId();
  const [state, setState] = useState<PhotoPanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<PhotoIdea[]>([]);
  const [scene, setScene] = useState("");
  const [style, setStyle] = useState<PhotoStyle>("photo");
  // 枚数の最初は 1 枚（2 枚だと気づかずに費用が倍になる。2026-11-18 オーナーの通しの指摘 19）
  const [count, setCount] = useState(1);
  const [candidates, setCandidates] = useState<Candidates | null>(null);
  // 選んだ候補（まとめて添えられる）と、もう添えた候補（同じ候補を 2 回添えない）
  const [picked, setPicked] = useState<string[]>([]);
  const [usedPaths, setUsedPaths] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [using, setUsing] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [making, startMake] = useTransition();
  const [acking, startAck] = useTransition();
  // lastIdea: 最後に選んだ AI の案の場面（選んだ案に印を付ける）。recent: 前に使った絵の説明（新しい順。絵の説明のフォーマットの代わり。2026-11-21 オーナーの決定）
  const [lastIdea, setLastIdea] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  // フォーマットの画像: 入れ直した seq と、まだつくっていない auto の seq（注意を読む前に押されたら、読んだあとにつくる）
  const [presetSeq, setPresetSeq] = useState<number | null>(null);
  const pendingAuto = useRef<number | null>(null);
  if (preset && preset.seq !== presetSeq) {
    setPresetSeq(preset.seq);
    setStyle(preset.style);
    setCount(1);
    setIdeas([]);
    setLastIdea("");
    setScene(preset.text);
    if (preset.auto) pendingAuto.current = preset.seq;
  }

  const presetRef = useRef(preset);
  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);

  useEffect(() => {
    let alive = true;
    void photoPanelState().then((r) => {
      if (!alive) return;
      if (r.state) setState(r.state);
      else setError(r.error ?? "読み込めませんでした。");
    });
    void listRecentScenes(projectId).then((r) => {
      if (alive && r.scenes) setRecent(r.scenes);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  function pickIdea(ideaScene: string) {
    setLastIdea(ideaScene);
    setScene(ideaScene);
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

  // フォーマットの画像の「つくる」: 注意を読んでいて、つくれるときだけ。AI が場面に書き換える設定なら、先に Claude が場面を 1 つ書く（2 つ続けて 1 回の「つくる」）
  useEffect(() => {
    const p = presetRef.current;
    if (!state?.enabled || !state.acknowledged || !p || pendingAuto.current !== p.seq) return;
    pendingAuto.current = null;
    if (state.globalReached || state.newUsersFull || state.remainingImages <= 0) return;
    startMake(async () => {
      let sc = p.text;
      if (p.scene === "ai") {
        setError(null);
        const r = await draftFormatPhotoScene(projectId, p.formatId, p.values, p.answer, targets);
        if (!r.scene) {
          setError(r.error ?? "うまくいきませんでした。");
          return;
        }
        sc = r.scene;
        setScene(sc);
      }
      await generateRef.current(sc, p.style, 1);
    });
  }, [state, presetSeq, projectId, targets]);
  const generateRef = useRef<(sc: string, st: PhotoStyle, cnt: number) => Promise<void>>(async () => {});

  if (!state) return error ? <ErrorBanner>{error}</ErrorBanner> : <p className="text-sm text-muted">読み込んでいます…</p>;

  // 鍵（GEMINI_API_KEY）がない間は、注意も絵の説明の案も出さない（規約・ポリシーの施行の前に、新しい使い道の情報を預からない・送らない）
  if (!state.enabled) {
    return <p className="rounded-md border border-dashed border-line px-4 py-3.5 text-sm text-muted">AI で写真・絵をつくる機能は、まだ使えません。</p>;
  }

  if (!state.acknowledged) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-line bg-surface2 px-4 py-3.5 text-sm leading-[1.8]">
        <p className="font-bold">AI でつくる画像について</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>つくった画像には、「AI で作った画像」の印が付きます。印は、画面の札と画像のデータに付きます。</li>
          <li>実在の人に似せると、見た人の誤解を招くことがあります。商品やお店を、本物の写真のように見せるのも同じです。実際よりよく見せると、景品表示法に触れることがあります。</li>
          <li>AI でつくった写真のような画像には、表示が要ります。Instagram・Facebook・Threads などの決まりです。投稿するときは、各 SNS で「AI で作った」表示も付けてください。</li>
          <li>絵の説明は、画像をつくる Google の AI に送ります。AI の学習には使われません。何をつくり、どう使うかは、あなたの責任です。</li>
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

  function draft() {
    startDraft(async () => {
      setError(null);
      const r = await draftPhotoIdeas(projectId, text, targets);
      if (!r.ideas) {
        setError(r.error ?? "うまくいきませんでした。");
        return;
      }
      setIdeas(r.ideas);
      pickIdea(r.ideas[0].scene);
    });
  }

  function make() {
    startMake(() => generate(scene, style, n));
  }

  async function generate(sc: string, st: PhotoStyle, cnt: number) {
    {
      setError(null);
      setNotice(null);
      const r = await generatePhotos({ projectId, scene: sc, style: st, size, count: cnt });
      if (state && r.remainingImages !== undefined) setState({ ...state, remainingImages: r.remainingImages });
      if (!r.candidates || !r.jobId) {
        setError(r.error ?? "画像をつくれませんでした。");
        return;
      }
      setCandidates({ jobId: r.jobId, items: r.candidates, scene: sc, signedAt: Date.now() });
      setPicked(r.candidates[0] ? [r.candidates[0].path] : []);
      setUsedPaths([]);
      if (r.partial) setNotice("頼んだ枚数の一部だけできました。できなかった分は、今月の枚数に数えません。");
    }
  }

  // 自動でつくるとき（上の useEffect）に、いまの size で呼ぶため
  generateRef.current = generate;

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
        if (!(await onUseAsIs(photo, `${AI_ALT_PREFIX}${candidates.scene}`.slice(0, MAX_ALT_LENGTH)))) break;
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


  return (
    <div className="flex flex-col gap-4">
      {preset && (
        <p className="text-[13px] leading-[1.7]">
          <span className="font-bold">フォーマット「{preset.name}」で決めた画像</span>
          <span className="ml-1.5 text-muted">{preset.scene === "ai" ? `AI が絵の説明を書いてからつくります。その分、約 ${SCENE_YEN.one[0]}〜${SCENE_YEN.one[1]} 円多くかかります。` : "フォーマットで決めた絵の説明でつくります。空欄には「1 書く」の言葉が入ります。"}</span>
        </p>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {/* 絵の説明と「本文から案を出す」を並べる（案のボタンが離れた灰色の箱にあり、自分で書くしかないように見えた。指摘 18）。押したときだけ AI を呼ぶ */}
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <label htmlFor={sceneId} className="text-[14px] font-bold">
            絵の説明
          </label>
          {state.ideasEnabled ? (
            <Button type="button" variant="secondary" size="sm" disabled={drafting || !hasText} onClick={draft}>
              {drafting ? "考えています…" : ideas.length ? "別の案を出す" : "本文から案を出す"}
            </Button>
          ) : (
            <NotReadyButton variant="secondary" size="sm">
              本文から案を出す
            </NotReadyButton>
          )}
          <span className="text-xs text-muted">
            {hasText ? `本文とアカウントの方針から、2〜3 案を出します。1 回 ${SCENE_YEN.ideas[0]}〜${SCENE_YEN.ideas[1]} 円ほどです。` : "本文を書くと、AI が絵の説明を考えます。自分で書いてもつくれます。"}
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
                  className={`flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left text-sm transition-colors ${lastIdea === idea.scene ? "border-primary bg-primary-soft" : "border-border bg-surface hover:border-primary"}`}
                >
                  <span className="font-bold">{idea.title}</span>
                  <span className="text-xs leading-[1.7] text-muted">{idea.why}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Textarea id={sceneId} value={scene} rows={4} maxLength={MAX_SCENE_CHARS} onChange={(e) => setScene(e.target.value)} placeholder="例: 朝の光が入る木のカウンターに、焼きたてのパンが並んでいる。近くから少し斜めに" className="py-2 text-sm" />
        <span className="text-xs text-muted">何が、どこで、どんな光と雰囲気かを書きます。画像に文字は入りません。文字は、あとで入れられます。</span>
        {!preset && recent.length > 0 && <RecentScenes scenes={recent} onPick={(s) => setScene([...s].slice(0, MAX_SCENE_CHARS).join(""))} />}
      </div>

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
          <Button type="button" disabled={!canMake || making || !scene.trim()} onClick={make}>
            {making ? "つくっています…" : `${n} 枚つくる・約 ${n * state.unitYen} 円`}
          </Button>
        ) : (
          <NotReadyButton>つくる</NotReadyButton>
        )}
        <span className="num text-sm text-muted">
          {state.globalReached
            ? "今月は、AI で画像をつくれる数がいっぱいです。来月 1 日から、またつくれます"
            : state.newUsersFull
              ? `登録してまもない方の今月の枠が、いっぱいです。${state.newUntil} から、またつくれます`
              : state.remainingImages > 0
                ? state.newUntil
                  ? `今月は、あと ${state.remainingImages} 枚つくれます。登録して ${PHOTO_LIMITS.newUserDays} 日までは、月 ${state.monthlyImages} 枚までです。${state.newUntil} からは ${PHOTO_LIMITS.userMonthlyImages} 枚になります。`
                  : `今月は、あと ${state.remainingImages} 枚つくれます。1 か月に ${state.monthlyImages} 枚までです。`
                : state.newUntil
                  ? `登録して ${PHOTO_LIMITS.newUserDays} 日までは月 ${state.monthlyImages} 枚です。${state.newUntil} から ${PHOTO_LIMITS.userMonthlyImages} 枚になります`
                  : `今月の ${state.monthlyImages} 枚を使い切りました。来月 1 日から、またつくれます`}
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
                    aria-label={used ? `${i + 1} 枚目の候補・添えました` : `${i + 1} 枚目の候補を選ぶ`}
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
            {/* 押すと何が起きるかがわかる名前にする（「見出しを重ねる」「このまま添える」の違いがわからなかった。指摘 20） */}
            <Button type="button" disabled={pickedItems.length === 0 || using} onClick={() => void use(true)}>
              {using
                ? "添えています…"
                : pickedItems.length > 1
                  ? `選んだ ${pickedItems.length} 枚を、${nextIndex}〜${nextIndex + pickedItems.length - 1} 枚目にそのまま添える`
                  : `${nextIndex} 枚目にそのまま添える`}
            </Button>
            <Button type="button" variant="secondary" disabled={pickedItems.length !== 1 || using} onClick={() => void use(false)}>
              文字を入れる
            </Button>
          </div>
          <p className="text-xs leading-[1.7] text-muted">「そのまま添える」は、文字なしで添えます。「文字を入れる」は、画像に文字を重ねてから添えます。</p>
          <p className="text-xs leading-[1.7] text-muted">
            {/* 見出しを重ねるが押せない理由（添えた画像には、その画像の行の「見出しを付ける」から付けられる。4.58） */}
            {remainingCandidates.length === 0
              ? "候補は、すべて添えました。文字は、下の画像の「画像の文字を付ける」から入れられます。続けてつくるときは、絵の説明を変えて「つくる」を押してください。"
              : `${pickedItems.length === 0 ? "文字を入れるときは、候補を 1 枚選んでください。" : pickedItems.length > 1 ? "文字を入れるのは 1 枚ずつです。" : ""}選ばなかった画像は 1 日で消えます。`}
          </p>
        </div>
      )}
    </div>
  );
}

// 前に使った絵の説明から選ぶ（このプロジェクトの投稿に添えた AI の画像の説明。新しい順に 5 件）。押すと、絵の説明の欄に入れる。
// 絵の説明のフォーマット（photo_prompt_templates）の代わり（2026-11-21 オーナーの決定「機能やメニューが増えすぎて、使いこなせない」）
function RecentScenes({ scenes, onPick }: { scenes: string[]; onPick: (scene: string) => void }) {
  return (
    <DisclosureBox label="前に使った絵の説明から選ぶ" count={scenes.length} size="sm" bodyClassName="mt-2">
      <p className="mb-2 text-xs text-muted">押すと、絵の説明の欄に入ります。</p>
      <ul className="flex flex-col gap-2">
        {scenes.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-left text-sm leading-[1.7] hover:border-primary"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </DisclosureBox>
  );
}
