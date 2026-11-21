"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BandCloseButton } from "@/components/ui/band-close";
import { Button } from "@/components/ui/button";
import { DisclosureBox } from "@/components/ui/disclosure";

// ホーム画面に追加する案内の部品（2026-11-21 オーナーのタスク。PM 了承）。
// 端末の見分けと手順の文は、ここ 1 か所に置く。お知らせの設定（push-settings.tsx）も、これを読む（付け替えは実装担当4）

export type InstallEnv = {
  platform: "ios" | "android" | "pc";
  // ホーム画面の yabumi から開いている（standalone）
  standalone: boolean;
  // iOS 16.4 より前（ホーム画面に追加しても通知は受け取れない）
  iosTooOld: boolean;
};

export function detectInstallEnv(): InstallEnv {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  const m = ua.match(/OS (\d+)_(\d+)/);
  // 版が読めないときは新しいとみなす
  const iosTooOld = ios && m !== null && (Number(m[1]) < 16 || (Number(m[1]) === 16 && Number(m[2]) < 4));
  return { platform: ios ? "ios" : android ? "android" : "pc", standalone, iosTooOld };
}

// ブラウザで 1 回だけ見分ける（サーバーでは決められないので null）。変わらない値なので、知らせは要らない
let cachedEnv: InstallEnv | null = null;
const noSubscribe = () => () => {};
export function useInstallEnv(): InstallEnv | null {
  return useSyncExternalStore(
    noSubscribe,
    () => (cachedEnv ??= detectInstallEnv()),
    () => null,
  );
}

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

// Android の Chrome などが「追加できます」と知らせてきたら、そのまま追加の画面を出せる（iPhone の Safari は知らせてこない）
export function useInstallPrompt(): { canPrompt: boolean; prompt: () => Promise<boolean> } {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  return {
    canPrompt: event !== null,
    prompt: async () => {
      if (!event) return false;
      await event.prompt();
      const { outcome } = await event.userChoice;
      setEvent(null);
      return outcome === "accepted";
    },
  };
}

// iPhone の共有ボタン（四角から上に矢印）の小さな図
export function ShareIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mx-0.5 inline-block size-4 -translate-y-px align-middle" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5v10M6.5 6 10 2.5 13.5 6" />
      <path d="M6 9H4.5v8.5h11V9H14" />
    </svg>
  );
}

// Android の Chrome の「︙」の小さな図
function MenuDotsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="mx-0.5 inline-block size-4 -translate-y-px align-middle" fill="currentColor">
      <circle cx="10" cy="4" r="1.6" />
      <circle cx="10" cy="10" r="1.6" />
      <circle cx="10" cy="16" r="1.6" />
    </svg>
  );
}

export function TooOld() {
  return <p>この端末の iOS は古いため、通知を受け取れません。iOS 16.4 以降が必要です。「設定」→「一般」→「ソフトウェアアップデート」から更新できます。</p>;
}

// iPhone・iPad（Safari）。withPush: 最後に「通知を受け取る」の手順を足す（お知らせの設定で使う）
export function IphoneSteps({ withPush = false }: { withPush?: boolean }) {
  return (
    <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5">
      <li>
        Safari で yabumi を開き、共有ボタン
        <ShareIcon />
        を押します。iPhone は画面の下、iPad は上にあります。見当たらないときは、「…」を押すと出てきます。
      </li>
      <li>「ホーム画面に追加」を選び、右上の「追加」を押します。見つからないときは、出てきた一覧の下のほうを見ます。</li>
      <li>スマホのホーム画面にできた yabumi のアイコンから開きます。</li>
      <li>同じメールアドレスで、もう一度ログインします。Safari でのログインは、引き継がれません。</li>
      {withPush && <li>「≡ メニュー」→「ログインと退会」→「お知らせの設定」を開きます。「この端末で通知を受け取る」を押し、「許可」を選びます。</li>}
    </ol>
  );
}

// Android（Chrome）
export function AndroidSteps() {
  return (
    <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5">
      <li>
        Chrome で yabumi を開き、右上の
        <MenuDotsIcon />
        を押します。
      </li>
      <li>「ホーム画面に追加」か「アプリをインストール」を選びます。出てきた画面で「インストール」か「追加」を押します。</li>
      <li>スマホのホーム画面にできた yabumi のアイコンから開きます。ログインはそのまま使えます。</li>
    </ol>
  );
}

// PC（Chrome・Edge）。印の形はブラウザと版で変わるので、形ではなく、マウスのポインターを乗せたときに出る名前で書く
// （Chrome は「インストール」、Edge は「アプリを使用できます」。2026-11-21 に Google・Microsoft の案内で確かめた）
export function PcSteps() {
  return (
    <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5">
      <li>Chrome か Edge で yabumi を開きます。アドレスバーの右端にある印を押します。</li>
      <li>印にマウスのポインターを乗せると、名前が出ます。Chrome は「インストール」、Edge は「アプリを使用できます」です。</li>
      <li>「インストール」を押すと、yabumi が別のウィンドウで開けるようになります。</li>
    </ol>
  );
}

// 帯を閉じたかを、この端末だけに覚える（その人の端末の便利のため。読めなくても困らない）
const BAND_CLOSED_KEY = "yabumi:add-to-home-band-closed";
function readBandClosed(): boolean {
  try {
    return localStorage.getItem(BAND_CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

// ホームの上の、1 回だけ出る小さな帯。スマホで、ホーム画面の yabumi から開いていないときだけ。閉じたら、この端末では出さない。
// pushReady: サーバーに通知の鍵（VAPID）が入っていて、通知を送れる。そのときだけ「iPhone では、通知も受け取れます。」を添える（スマホの通知の帯と 1 本。2026-11-21 オーナーの返事）
export function AddToHomeBand({ pushReady }: { pushReady: boolean }) {
  const env = useInstallEnv();
  const install = useInstallPrompt();
  // 前に閉じたか（この端末に覚えたもの。サーバーでは出さないので true）と、この画面で閉じたか
  const closedBefore = useSyncExternalStore(noSubscribe, readBandClosed, () => true);
  const [closedNow, setClosedNow] = useState(false);
  if (!env || closedBefore || closedNow || env.standalone || env.platform === "pc") return null;
  const close = () => {
    setClosedNow(true);
    try {
      localStorage.setItem(BAND_CLOSED_KEY, "1");
    } catch {}
  };
  return (
    <aside aria-label="スマホのホーム画面に追加する" className="flex items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-4 py-2 text-sm max-sm:flex-wrap max-sm:px-3">
      <p className="min-w-0 flex-1 leading-[1.7] max-sm:basis-full">
        スマホのホーム画面に yabumi を置くと、アプリのように開けます。
        {pushReady && env.platform === "ios" && !env.iosTooOld && "追加して設定すると、iPhone に yabumi の通知が届きます。"}
      </p>
      {install.canPrompt && env.platform !== "ios" ? (
        <Button type="button" size="sm" onClick={() => void install.prompt().then((ok) => ok && close())}>
          スマホのホーム画面に追加する
        </Button>
      ) : (
        <Link href="/settings/add-to-home" className="shrink-0 font-semibold whitespace-nowrap text-primary hover:underline">
          やり方を見る →
        </Link>
      )}
      <BandCloseButton label="スマホのホーム画面に追加する案内を閉じる" className="max-sm:ml-auto" onClick={close} />
    </aside>
  );
}

// 案内のページの中身。開いた端末の手順を先に出し、ほかの端末の手順は畳んで持つ
// pushReady: サーバーに通知の鍵（VAPID）があり、通知を送れる。そのときだけ、iPhone の手順に「お知らせの設定」の手順を足す（帯と同じ）
export function AddToHomeGuide({ pushReady }: { pushReady: boolean }) {
  const env = useInstallEnv();
  const install = useInstallPrompt();
  const [added, setAdded] = useState(false);
  if (!env) return <p className="text-sm text-muted">読み込んでいます…</p>;
  const sections = [
    { key: "ios", title: "iPhone・iPad", body: env.iosTooOld ? (<><IphoneSteps /><TooOld /></>) : <IphoneSteps withPush={pushReady} /> },
    { key: "android", title: "Android", body: <AndroidSteps /> },
    { key: "pc", title: "パソコン", body: <PcSteps /> },
  ] as const;
  const mine = sections.find((s) => s.key === env.platform)!;
  // パソコンでは「スマホのホーム画面」と言わない（追加すると、別のウィンドウで開けるようになる）
  const pc = env.platform === "pc";
  const others = sections.filter((s) => s.key !== env.platform);
  return (
    <div className="flex flex-col gap-5 text-[14px] leading-[1.8]">
      {env.standalone ? (
        <p className="rounded-md border border-line bg-surface2 px-4 py-3">{pc ? "この画面は、追加した yabumi のウィンドウで開いています。もう追加できています。" : "この画面は、スマホのホーム画面の yabumi から開いています。もう追加できています。"}</p>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-[16px] font-bold">{mine.title}</h2>
          {install.canPrompt && env.platform !== "ios" && !added && (
            <Button type="button" className="self-start" onClick={() => void install.prompt().then((ok) => setAdded(ok))}>
              {pc ? "パソコンに yabumi を追加する" : "スマホのホーム画面に追加する"}
            </Button>
          )}
          {added ? <p>{pc ? "追加しました。yabumi を別のウィンドウで開けます。" : "追加しました。スマホのホーム画面の yabumi から開けます。"}</p> : mine.body}
        </section>
      )}
      {others.map((s) => (
        <DisclosureBox key={s.key} label={`${s.title}の手順を表示`}>
          {s.body}
        </DisclosureBox>
      ))}
    </div>
  );
}
