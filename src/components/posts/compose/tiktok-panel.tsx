"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { getTikTokCreator } from "@/lib/sns/tiktok/actions";
import { callAction } from "@/lib/client-errors";
import { PRIVACY_LABEL, commercialLabel, consentDeclaration, type PrivacyLevel } from "@/lib/sns/tiktok/publish";
import { type Composer } from "./use-composer";

// ⑤ 送るの TikTok の欄（docs/design/tiktok.md の 3.。TikTok の審査で確かめられる決まりのとおり）。
// 開くたびに creator_info を読み、ニックネームを出す。公開範囲は利用者が選ぶ（最初は選んでいない）。コメント・宣伝の内容は最初はオフ。
// 送るボタンの前に同意の文とリンク、TikTok だけのプレビュー。yabumi の透かしやロゴは付けない
export function ComposeTikTok({ c }: { c: Composer }) {
  const { projectId, tiktokChoice: ch, setTikTokChoice, tiktokCreator, setTikTokCreator, tiktokByHand, setTikTokByHand, clearFieldError, images, titles, shownText, markTyped } = c;
  const set = (patch: Partial<typeof ch>) => {
    markTyped();
    setTikTokChoice((x) => ({ ...x, ...patch }));
  };

  useEffect(() => {
    let alive = true;
    setTikTokCreator(null);
    void callAction(() => getTikTokCreator(projectId)).then((r) => {
      if (!alive) return;
      setTikTokCreator(r.ok ? r.value : { error: "TikTok のアカウントの状態を読めませんでした。時間をおいてもう一度お試しください。" });
    });
    return () => {
      alive = false;
    };
  }, [projectId, setTikTokCreator]);

  const creator = tiktokCreator?.creator;
  const direct = ch.mode === "DIRECT_POST";
  const declaration = consentDeclaration(direct && ch.commercial && ch.brandContent);
  const label = commercialLabel({ brandOrganic: ch.commercial && ch.brandOrganic, brandContent: ch.commercial && ch.brandContent });
  const title = titles.tiktok ?? "";
  const text = shownText("tiktok");
  const cover = images[0]?.previewUrl ?? null;

  return (
    <section aria-labelledby="tiktok-panel" className="flex flex-col gap-3 rounded-md border border-line px-4 py-3.5">
      <h3 id="tiktok-panel" className="text-[15px] font-bold">
        TikTok に送る内容の確認
      </h3>

      {/* TikTok は手で投稿する（docs/design/tiktok.md の 17.）。審査の前に公開で出したいとき・音楽を付けたいとき・送れないときの逃げ道 */}
      {tiktokByHand ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[1.7]">
          <span className="text-muted">TikTok は手で投稿します。yabumi からは送りません。ほかの SNS を送ったあと、送信の結果の「TikTok に手で投稿する」から、TikTok のアプリで投稿して記録できます。</span>
          <Button type="button" variant="text" size="sm" onClick={() => setTikTokByHand(false)}>
            やめる
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="text-muted">TikTok のアプリで音楽を付けたい・公開で出したいときは</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setTikTokByHand(true);
              clearFieldError("targets");
            }}
          >
            TikTok は手で投稿する
          </Button>
        </div>
      )}

      {!tiktokByHand && !tiktokCreator && <p className="text-[13px] text-muted">TikTok のアカウントの状態を読んでいます…</p>}
      {!tiktokByHand && tiktokCreator?.error && <p className="text-[13px] font-semibold text-danger">{tiktokCreator.error}</p>}

      {!tiktokByHand && creator && (
        <>
          <p className="flex items-center gap-2 text-[14px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- TikTok のアイコン（2 時間で切れる URL。保存しない） */}
            {creator.avatarUrl && <img src={creator.avatarUrl} alt="" className="size-7 rounded-full" />}
            <span>
              <b>{creator.nickname || creator.username}</b>
              {creator.username && <span className="ml-1 text-muted">@{creator.username}</span>}
              <span className="ml-1">として投稿します</span>
            </span>
          </p>

          {!creator.audited && (
            <p className="rounded-md bg-surface2 px-3 py-2 text-[13px] leading-[1.7]">
              <span className="mr-1.5 font-bold text-signal">● 要確認</span>
              いまは、yabumi が TikTok の審査を受けている途中のため、TikTok には『自分だけ』に見える投稿しかできません（yabumi の準備の都合で、あなたのアカウントの問題ではありません）。送る前に、TikTok のアカウントを非公開にしてください。審査が終わると、公開範囲を選べるようになります。
            </p>
          )}

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-bold">送り方</legend>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="tiktok-mode" checked={direct} disabled={!creator.canDirect} onChange={() => set({ mode: "DIRECT_POST" })} />
              そのまま投稿する
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="tiktok-mode" checked={!direct} disabled={!creator.canInbox} onChange={() => set({ mode: "MEDIA_UPLOAD" })} />
              TikTok のアプリで仕上げる（受信箱に下書きとして送る）
            </label>
            {!direct && <p className="text-[12px] leading-[1.7] text-muted">送ると TikTok のアプリに通知が届きます。通知から開いて、公開範囲などを決めて投稿してください。未完了の下書きは 24 時間で 5 件までです。</p>}
            <p className="text-[12px] leading-[1.7] text-muted">TikTok に送れるのは 1 日 15 本ほどまでです（ほかのアプリから投稿した分も含みます）。</p>
          </fieldset>

          {direct && (
            <>
              <label className="flex flex-col gap-1 text-[14px]">
                <span className="text-[13px] font-bold">公開範囲</span>
                <select
                  value={ch.privacyLevel ?? ""}
                  onChange={(e) => set({ privacyLevel: (e.target.value || null) as PrivacyLevel | null })}
                  className="w-fit rounded-md border border-input bg-surface px-3 py-2 text-sm"
                >
                  <option value="">選んでください</option>
                  {creator.privacyOptions.map((p) => (
                    <option key={p} value={p} disabled={p === "SELF_ONLY" && ch.commercial && ch.brandContent} title={p === "SELF_ONLY" && ch.commercial && ch.brandContent ? "Branded content visibility cannot be set to private." : undefined}>
                      {PRIVACY_LABEL[p as PrivacyLevel] ?? p}
                    </option>
                  ))}
                </select>
              </label>

              <label className={`flex items-center gap-2 text-[14px] ${creator.commentDisabled ? "text-muted" : ""}`}>
                <input type="checkbox" checked={ch.allowComment} disabled={creator.commentDisabled} onChange={(e) => set({ allowComment: e.target.checked })} />
                コメントを許可する
                {creator.commentDisabled && <span className="text-[12px]">（TikTok の設定でコメントが「誰もできない」になっています）</span>}
              </label>

              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-[14px]">
                  <input type="checkbox" role="switch" checked={ch.commercial} onChange={(e) => set({ commercial: e.target.checked, ...(e.target.checked ? {} : { brandOrganic: false, brandContent: false }) })} />
                  宣伝の内容を含む（Commercial content disclosure）
                </label>
                {ch.commercial && (
                  <div className="flex flex-col gap-1 pl-6 text-[14px]" title="You need to indicate if your content promotes yourself, a third party, or both.">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={ch.brandOrganic} onChange={(e) => set({ brandOrganic: e.target.checked })} />
                      自分のブランド（Your brand）: 自分の商品・お店・サービスの宣伝
                    </label>
                    {/* 審査の前は「自分だけ」しか選べず、ブランドコンテンツは「自分だけ」にできないので、押せなくして理由を見える形で出す */}
                    <label className={`flex items-center gap-2 ${creator.audited ? "" : "text-muted"}`}>
                      <input
                        type="checkbox"
                        aria-describedby={creator.audited ? undefined : "tiktok-bc-unaudited"}
                        checked={ch.brandContent}
                        disabled={!creator.audited || ch.privacyLevel === "SELF_ONLY"}
                        title={creator.audited && ch.privacyLevel === "SELF_ONLY" ? "Branded content visibility cannot be set to private." : undefined}
                        onChange={(e) => set({ brandContent: e.target.checked })}
                      />
                      ブランドコンテンツ（Branded content）: ほかの会社から頼まれた・お礼をもらった宣伝
                    </label>
                    {!creator.audited && (
                      <p id="tiktok-bc-unaudited" className="pl-6 text-xs text-muted">
                        ブランドコンテンツは、yabumi の審査が終わると選べます
                      </p>
                    )}
                    {label && <p className="text-[12px] text-muted">{label}（TikTok でこのラベルが付きます）</p>}
                    {!ch.brandOrganic && !ch.brandContent && <p className="text-[12px] text-signal">どちらかを選ぶと送れます</p>}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex flex-col gap-2 rounded-md bg-surface2 p-3">
            <span className="text-[12px] font-bold text-muted">TikTok での見え方</span>
            <div className="flex gap-3">
              <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-md bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element -- 添えた写真の署名つき URL */}
                {cover ? <img src={cover} alt="" className="size-full object-cover" /> : <span className="flex size-full items-center justify-center text-[12px] text-muted">写真が要ります</span>}
                {images.length > 1 && <span className="absolute top-1 right-1 rounded-full bg-scrim px-1.5 text-[11px] text-on-primary">1 / {images.length}</span>}
              </div>
              <div className="flex min-w-0 flex-col gap-1 text-[13px]">
                <b className="truncate">{creator.nickname || creator.username}</b>
                {title && <span className="font-bold break-words">{title}</span>}
                <span className="line-clamp-4 break-words whitespace-pre-wrap text-muted">{text}</span>
              </div>
            </div>
            <span className="text-[12px] text-muted">タイトルと説明は、② 送り先の TikTok の欄で編集できます。送ったあと、TikTok で反映されるまで数分かかることがあります。</span>
          </div>

          <p className="text-[13px] leading-[1.7]">
            {declaration.text.split(/(Branded Content Policy|Music Usage Confirmation)/).map((part, i) => {
              const link = declaration.links.find((l) => l.label === part);
              return link ? (
                <a key={i} href={link.href} target="_blank" rel="noreferrer" className="underline">
                  {part}
                </a>
              ) : (
                <span key={i}>{part}</span>
              );
            })}
            <span className="block text-[12px] text-muted">送ると、TikTok の{direct && ch.commercial && ch.brandContent ? "ブランドコンテンツのポリシーと" : ""}音楽の利用の確認に同意したことになります。</span>
          </p>
        </>
      )}
    </section>
  );
}
