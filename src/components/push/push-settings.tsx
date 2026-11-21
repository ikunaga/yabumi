"use client";

import { useEffect, useState } from "react";
import { Button, NotReadyButton } from "@/components/ui/button";
import { ErrorBanner, SuccessBanner } from "@/components/ui/feedback";
import { type PushStatus, pushStatus, subscribeDevice, testPushDevice, unsubscribeDevice } from "@/lib/push/actions";
import { DisclosureBox } from "@/components/ui/disclosure";
import { AndroidSteps, detectInstallEnv, IphoneSteps, TooOld } from "@/components/pwa/add-to-home";

// スマホの通知（Web Push）の端末の登録・外す、スマホのホーム画面に追加する手順、試しに送る（docs/architecture.md の 4.28）。
// 端末の見分けと、ホーム画面に追加する手順の文は @/components/pwa/add-to-home の 1 か所に置き、ここはそれを読む（2026-11-21）。
// お知らせの設定（/settings/notifications）の「スマホの通知」のカードに置く。
// 通知の許可は、利用者が「この端末で通知を受け取る」を押したときにだけ求める（開いたとたんに聞かない）

type Env =
  | { kind: "loading" }
  // iPhone・iPad の Safari など（ホーム画面に追加した yabumi からでないと受け取れない）
  | { kind: "ios-browser"; tooOld: boolean }
  | { kind: "ios-too-old" }
  | { kind: "unsupported" }
  | { kind: "ready"; ios: boolean; android: boolean };

// 端末の見分けは add-to-home の detectInstallEnv。通知を受け取れるブラウザかだけ、ここで見る
function detectEnv(): Exclude<Env, { kind: "loading" }> {
  const { platform, standalone, iosTooOld: tooOld } = detectInstallEnv();
  const ios = platform === "ios";
  const android = platform === "android";
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (ios && !standalone) return { kind: "ios-browser", tooOld };
  if (ios && tooOld) return { kind: "ios-too-old" };
  if (!supported) return { kind: "unsupported" };
  return { kind: "ready", ios, android };
}

// VAPID の公開鍵（base64url）を、ブラウザが受け取る形に
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer, b: Uint8Array) {
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

async function registration() {
  // ルートのレイアウトが登録している（src/components/service-worker.tsx）。まだなら、ここで登録する
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (!existing) await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

type Loaded = { env: Exclude<Env, { kind: "loading" }>; permission: NotificationPermission | null; status: PushStatus | { error: string } };

// 画面を開いたとき・操作のあとに、この端末の状態とサーバーの登録を読む
async function load(): Promise<Loaded> {
  const env = detectEnv();
  let endpoint: string | null = null;
  if (env.kind === "ready") {
    const reg = await registration().catch(() => null);
    endpoint = (await reg?.pushManager.getSubscription().catch(() => null))?.endpoint ?? null;
  }
  const status = await pushStatus(endpoint);
  return { env, permission: env.kind === "ready" ? Notification.permission : null, status };
}

const dateFormat = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" });

export function PushSettings() {
  const [env, setEnv] = useState<Env>({ kind: "loading" });
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function apply(r: Loaded) {
    setEnv(r.env);
    setPermission(r.permission);
    if ("error" in r.status) setError(r.status.error);
    else setStatus(r.status);
  }

  async function refresh() {
    apply(await load());
  }

  useEffect(() => {
    let alive = true;
    load().then(
      (r) => alive && apply(r),
      () => alive && setError("読み込めませんでした。画面を読み込み直してください。"),
    );
    return () => {
      alive = false;
    };
  }, []);

  async function run(action: () => Promise<string | null | void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const done = await action();
      if (done) setNotice(done);
    } catch {
      setError("うまくいきませんでした。画面を読み込み直して、もう一度お試しください。");
    } finally {
      await refresh().catch(() => {});
      setBusy(false);
    }
  }

  // ボタンを押したときにだけ、通知の許可を求める
  function subscribe() {
    return run(async () => {
      if (!status?.publicKey) return;
      const result = await Notification.requestPermission();
      if (result !== "granted") {
        setError("通知が許可されませんでした。下の「通知を許可していないとき」の手順で許可してから、もう一度押してください。");
        return;
      }
      const reg = await registration();
      const key = keyBytes(status.publicKey);
      let sub = await reg.pushManager.getSubscription();
      // 鍵が替わっていたら（運営者が鍵を作り直したとき）、作り直す
      if (sub && sub.options.applicationServerKey && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const r = await subscribeDevice(sub.toJSON());
      if (r.error) return void setError(r.error);
      return "この端末で通知を受け取れるようにしました。「試しに送る」で届くか確認できます。";
    });
  }

  function unsubscribeThis(id: string) {
    return run(async () => {
      const reg = await registration().catch(() => null);
      await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => {});
      const r = await unsubscribeDevice(id);
      if (r.error) return void setError(r.error);
      return "この端末では受け取らないようにしました。";
    });
  }

  function removeOther(id: string, label: string) {
    return run(async () => {
      const r = await unsubscribeDevice(id);
      if (r.error) return void setError(r.error);
      return `${label}では受け取らないようにしました。`;
    });
  }

  function test(id: string) {
    return run(async () => {
      const r = await testPushDevice(id);
      if (r.error) return void setError(r.error);
      return "送りました。数秒で届きます。届かないときは、下の「届かないとき」を見てください。";
    });
  }

  if (env.kind === "loading") {
    return error ? <ErrorBanner>{error}</ErrorBanner> : <p className="text-sm text-muted">読み込んでいます…</p>;
  }

  const current = status?.devices.find((d) => d.id === status.currentId) ?? null;
  const others = status?.devices.filter((d) => d.id !== status.currentId) ?? [];
  const ios = env.kind !== "ready" ? env.kind !== "unsupported" : env.ios;
  const android = env.kind === "ready" && env.android;

  return (
    <div className="flex flex-col gap-4 text-[14px] leading-[1.7]">
      <p className="text-muted">伴走の声かけ（投稿のペースが遅れそうなとき、毎週の振り返り）を、この端末に通知で届けます。通知は端末ごとに登録します。</p>

      {error && <ErrorBanner>{error}</ErrorBanner>}
      {notice && <SuccessBanner>{notice}</SuccessBanner>}

      {env.kind === "ios-browser" && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-surface2 p-4">
          <p className="font-bold">iPhone・iPad では、スマホのホーム画面に追加すると通知を受け取れます</p>
          {env.tooOld ? <TooOld /> : <IphoneSteps withPush />}
        </div>
      )}
      {env.kind === "ios-too-old" && <TooOld />}
      {env.kind === "unsupported" && <p>このブラウザは通知を受け取れません。Chrome・Edge・Firefox・Safari の新しい版でお試しください。</p>}

      {env.kind === "ready" &&
        status &&
        (!status.publicKey ? (
          <NotReadyButton>この端末で通知を受け取る</NotReadyButton>
        ) : current ? (
          <div className="flex flex-col gap-3 rounded-md border border-line p-4">
            <p>
              <span className="font-bold">この端末（{current.label}）で受け取っています。</span>
              <span className="text-muted">
                {dateFormat.format(new Date(current.createdAt))} に登録
                {current.lastSuccessAt && `。最後に届けたのは ${dateFormat.format(new Date(current.lastSuccessAt))}`}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => test(current.id)}>
                試しに送る
              </Button>
              <Button type="button" variant="text" size="sm" disabled={busy} onClick={() => unsubscribeThis(current.id)}>
                この端末では受け取らないようにする
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <Button type="button" disabled={busy} onClick={subscribe}>
              {busy ? "登録しています…" : "この端末で通知を受け取る"}
            </Button>
            <p className="text-xs text-muted">押すと、ブラウザが「通知を許可しますか」と聞きます。「許可」を選んでください。</p>
          </div>
        ))}

      {permission === "denied" && !current && <DeniedHelp ios={ios} android={android} />}

      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-bold">ほかに登録している端末</p>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {others.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5">
                <span>
                  {d.label}
                  <span className="text-xs text-muted">（{dateFormat.format(new Date(d.createdAt))} に登録）</span>
                </span>
                <Button type="button" variant="text" size="sm" disabled={busy} onClick={() => removeOther(d.id, d.label)}>
                  受け取らないようにする
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <DisclosureBox label="スマホのホーム画面に追加する手順を表示">
        <div className="flex flex-col gap-4">
          <div>
            <p className="font-bold">iPhone・iPad</p>
            <p>iOS 16.4 以降で、通知を受け取れます。</p>
            <IphoneSteps withPush />
          </div>
          <div>
            <p className="font-bold">Android</p>
            <p>Chrome なら、スマホのホーム画面に追加しなくても通知を受け取れます。アプリのように開きたいときは、次の手順で追加します。</p>
            <AndroidSteps />
            <p className="mt-1">追加したら、この画面で「この端末で通知を受け取る」を押します。</p>
          </div>
        </div>
      </DisclosureBox>

      <DisclosureBox label="届かないときの確認のしかたを表示">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>「おやすみモード」や「集中モード」がオンだと、通知が出ないことがあります</li>
          <li>iPhone・iPad は、スマホのホーム画面の yabumi から登録したときだけ届きます。Safari で開いた画面からは登録できません</li>
          <li>端末の設定で、yabumi （またはブラウザ）の通知が許可されているか確認してください</li>
          <li>ブラウザのデータを消すと、登録も消えます。もう一度「この端末で通知を受け取る」を押してください</li>
          <li>ログアウトすると、その端末には届かなくなります（同じ端末をほかの人が使っても、あなたへの通知が出ないように）</li>
        </ul>
      </DisclosureBox>
    </div>
  );
}

function DeniedHelp({ ios, android }: { ios: boolean; android: boolean }) {
  const pc = !ios && !android;
  return (
    <div className="rounded-md border border-line bg-surface2 p-4">
      <p className="font-bold">通知を許可していないとき</p>
      <p>前に「許可しない」を選んだため、ブラウザが聞いてこない状態です。次の手順で許可してから、この画面を開き直してください。</p>
      <ul className="mt-1 list-disc pl-5">
        {ios && <li>iPhone・iPad: 「設定」アプリ →「通知」→「yabumi」→「通知を許可」をオン</li>}
        {android && <li>Android の Chrome: アドレスバーの左のアイコン →「権限」（または「サイトの設定」）→「通知」→「許可」</li>}
        {pc && <li>パソコン: アドレスバーの左のアイコン →「通知」→「許可」</li>}
      </ul>
    </div>
  );
}
