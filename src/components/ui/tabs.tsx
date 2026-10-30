// タブ（見本 B の「X・Instagram・TikTok」）: 下に線を引いた並び。選んでいるものは黒い下線と太字
export const tabListClass = "flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border";

export function tabClass(on: boolean) {
  return `-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors duration-[120ms] ${
    on ? "border-primary font-bold text-fg" : "border-transparent text-muted hover:text-fg"
  }`;
}
