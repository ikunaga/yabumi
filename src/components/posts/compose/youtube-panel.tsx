"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { callAction } from "@/lib/client-errors";
import { getYouTubeChannel } from "@/lib/sns/youtube/actions";
import { isShortsShape, YOUTUBE_CATEGORIES, YOUTUBE_PRIVACY, YOUTUBE_PRIVACY_LABEL, type YouTubeChoice } from "@/lib/sns/youtube/choice";
import { type Composer } from "./use-composer";

// ⑤ 送るの YouTube の欄（docs/design/youtube.md の 4.）。開くたびにつないだチャンネルを読み、送り先を出す。
// 公開範囲と子ども向けかは利用者が選ぶ（最初は選んでいない。Y6・COPPA）。送る・予約するのボタンが、この内容への同意を兼ねる。
// yabumi は説明に文を足さず、透かしやロゴも付けない
export function ComposeYouTube({ c }: { c: Composer }) {
  const { projectId, youtubeChoice: ch, setYouTubeChoice, youtubeChannel, setYouTubeChannel, youtubeByHand, setYouTubeByHand, clearFieldError, titles, markTyped, video } = c;
  const set = (patch: Partial<YouTubeChoice>) => {
    markTyped();
    setYouTubeChoice((x) => ({ ...x, ...patch }));
  };

  useEffect(() => {
    let alive = true;
    setYouTubeChannel(null);
    void callAction(() => getYouTubeChannel(projectId)).then((r) => {
      if (!alive) return;
      setYouTubeChannel(r.ok ? r.value : { error: "YouTube のチャンネルを読めませんでした。時間をおいてもう一度お試しください。" });
    });
    return () => {
      alive = false;
    };
  }, [projectId, setYouTubeChannel]);

  const channel = youtubeChannel?.channel;
  const title = (titles.youtube ?? "").trim();

  return (
    <section aria-labelledby="youtube-panel" className="flex flex-col gap-3 rounded-md border border-line px-4 py-3.5">
      <h3 id="youtube-panel" className="text-[15px] font-bold">
        YouTube に送る内容の確認
      </h3>

      {/* YouTube は手で投稿する（docs/design/youtube.md の 12.。Y4）。1 日の上限に当たったとき・YouTube のアプリで仕上げたいときの逃げ道 */}
      {youtubeByHand ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[1.7]">
          <span className="text-muted">YouTube は手動で投稿します。yabumi からは送りません。ほかの SNS に送ったら、「送信の結果」を開きます。「YouTube に手動で投稿する」から投稿してください。</span>
          <Button type="button" variant="text" size="sm" onClick={() => setYouTubeByHand(false)}>
            やめる
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <span className="text-muted">YouTube のアプリで仕上げたい・今日の上限に当たったときは</span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setYouTubeByHand(true);
              clearFieldError("targets");
            }}
          >
            YouTube は手動で投稿する
          </Button>
        </div>
      )}

      {!youtubeByHand && !youtubeChannel && <p className="text-[13px] text-muted">YouTube のチャンネルを読んでいます…</p>}
      {!youtubeByHand && youtubeChannel?.error && <p className="text-[13px] font-semibold text-danger">{youtubeChannel.error}</p>}

      {!youtubeByHand && channel && (
        <>
          <p className="text-[14px]">
            <b>{channel.title}</b>
            {channel.handle && <span className="ml-1 text-muted">@{channel.handle}</span>}
            <span className="ml-1">のチャンネルに上げます</span>
          </p>

          <label className="flex flex-col gap-1 text-[14px]">
            <span className="text-[13px] font-bold">公開範囲</span>
            <select
              value={ch.privacyStatus ?? ""}
              onChange={(e) => set({ privacyStatus: (e.target.value || null) as YouTubeChoice["privacyStatus"] })}
              className="w-fit rounded-md border border-input bg-surface px-3 py-2 text-sm"
            >
              <option value="">選んでください</option>
              {YOUTUBE_PRIVACY.map((p) => (
                <option key={p} value={p}>
                  {YOUTUBE_PRIVACY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[13px] font-bold">子ども向けの動画ですか</legend>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="youtube-kids" checked={ch.madeForKids === false} onChange={() => set({ madeForKids: false })} />
              いいえ、子ども向けではありません
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="youtube-kids" checked={ch.madeForKids === true} onChange={() => set({ madeForKids: true })} />
              はい、13 歳未満の子ども向けです
            </label>
            <p className="text-[12px] leading-[1.7] text-muted">アメリカの法律で、YouTube のすべての動画に決めることになっています。「はい」にすると、コメントなどが使えなくなります。</p>
          </fieldset>

          <label className="flex items-start gap-2 text-[14px]">
            <input type="checkbox" role="switch" className="mt-1" checked={ch.syntheticMedia} onChange={(e) => set({ syntheticMedia: e.target.checked })} />
            <span>
              AI などで作り変えた映像を含む
              <span className="block text-[12px] leading-[1.7] text-muted">本物と見分けにくい AI の映像のときに選びます。YouTube に申告されます。</span>
            </span>
          </label>

          <label className="flex flex-col gap-1 text-[14px]">
            <span className="text-[13px] font-bold">カテゴリ</span>
            <select value={ch.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className="w-fit rounded-md border border-input bg-surface px-3 py-2 text-sm">
              {YOUTUBE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </label>

          {/* ショートになるか（API に項目はなく、YouTube が長さと縦横で決める。docs/design/youtube.md の 4.） */}
          <p className="text-[12px] leading-[1.7] text-muted">
            {video && video.width && video.height
              ? isShortsShape({ durationMs: video.durationMs, width: video.width, height: video.height })
                ? "この動画は、YouTube ショートとして出ます。"
                : "この動画は、ふつうの動画として出ます。ショートにするには、3 分以内の縦長か正方形にしてください。"
              : "3 分以内の縦長か正方形の動画は、YouTube ショートとして出ます。それより長い・横長の動画は、ふつうの動画として出ます。"}
          </p>

          <div className="flex flex-col gap-1 rounded-md bg-surface2 p-3 text-[13px]">
            <span className="text-[12px] font-bold text-muted">この内容で上げます</span>
            <span>
              <b>{title || "タイトルがまだありません"}</b>
            </span>
            <span className="text-muted">
              {ch.privacyStatus ? YOUTUBE_PRIVACY_LABEL[ch.privacyStatus] : "公開範囲はまだ選んでいません"}・{ch.madeForKids === null ? "子ども向けかはまだ選んでいません" : ch.madeForKids ? "子ども向け" : "子ども向けではない"}
              {ch.syntheticMedia && "・AI などで作り変えた映像あり"}
            </span>
            <span className="text-[12px] text-muted">タイトルと説明は、「2 送り先」の YouTube の欄で編集できます。予約の時刻に上げ始めるので、YouTube に出るのは数分遅れることがあります。</span>
          </div>

          <p className="text-[12px] leading-[1.7] text-muted">
            YouTube に送ると、
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="underline">
              YouTube 利用規約
            </a>
            に従うことになります。
          </p>
        </>
      )}
    </section>
  );
}
