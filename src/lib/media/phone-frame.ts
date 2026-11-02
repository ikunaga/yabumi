import type { DrawOp } from "./templates";

// スマホの枠の描き方（「縦横を整える」のスマホの枠と、テンプレートの「写真に見出し」の端末の枠で共通。docs/architecture.md の 4.18）。
// ひと目でスマホとわかるよう、太めの縁・金属の帯・画面の上の真ん中の丸いカメラの穴・側面の小さなボタンを描く。
// 実在の機種の形（ノッチやダイナミックアイランドの形そのもの）やロゴは描かない。ここは計算だけで、Canvas には触らない

export type PhoneOrientation = "portrait" | "landscape";
export type PhoneFrameColor = "black" | "white";

// 太さ・丸み（画面の短い辺に対する割合）
export const PHONE_PARTS = {
  bezel: 0.04, // 画面のまわりの縁
  band: 0.012, // 縁の外側の帯（金属の側面に見える）
  ring: 0.004, // 地に紛れないよう外側に置く細い輪
  radius: 0.1, // 画面の角の丸み（大きくしすぎると、Android のスクショのステータスバーの左右の時刻・電池が角で欠ける）
  button: 0.01, // 側面のボタンの出っ張り
  camera: 0.018, // カメラの穴の半径
  cameraTop: 0.034, // 画面の上の端から、カメラの穴の真ん中まで（穴の下の端が 0.052。Android の標準のステータスバー 24dp ÷ 幅 411dp ≒ 0.058 の内に収まる）
} as const;

// 画面の外に枠が張り出す長さ（画面の短い辺に対する割合）。ボタンの出っ張りまで含める
export const PHONE_EDGE = PHONE_PARTS.bezel + PHONE_PARTS.band + PHONE_PARTS.button;

// 色（画像の中身の色。画面の色ではない）。輪は、黒枠には明るい輪、白枠には暗い輪
const COLORS: Record<PhoneFrameColor, { bezel: string; band: string; ring: string }> = {
  black: { bezel: "#0b0b0d", band: "#2c2c31", ring: "rgba(255,255,255,0.22)" },
  white: { bezel: "#f6f6f4", band: "#cfcfcb", ring: "rgba(0,0,0,0.16)" },
};
const CAMERA = { hole: "#0a0a0c", lens: "#1c2433" };

type Rect = { x: number; y: number; w: number; h: number };
export type PhoneScreen = Rect & { r: number };
export type PhoneFrame = {
  // 画面より下に描くもの（輪・ボタン・帯・縁）と、画面より上に描くもの（カメラの穴）
  back: DrawOp[];
  front: DrawOp[];
  // 画面の角の丸み（画像や見本の枠をこの丸みで切る）
  screenR: number;
  // カメラの穴の真ん中と半径（テストで、画面の中の上の真ん中にあるかを確かめる）
  camera: { cx: number; cy: number; r: number };
};

// 縦向きのスマホの真ん中を原点にした部品の位置を、横向きなら 90 度回す（上の端が左へ。横向きで持つと、カメラは左に来る）
function place(r: Rect, cx: number, cy: number, orientation: PhoneOrientation): Rect {
  if (orientation === "portrait") return { x: cx + r.x, y: cy + r.y, w: r.w, h: r.h };
  return { x: cx + r.y, y: cy - (r.x + r.w), w: r.h, h: r.w };
}

// 画面（screen）のまわりに枠を描く。画面そのもの（画像か見本の枠）は呼ぶ側が back と front のあいだに置く
export function phoneFrameOps(screen: Rect, orientation: PhoneOrientation, color: PhoneFrameColor): PhoneFrame {
  const s = Math.min(screen.w, screen.h);
  const P = PHONE_PARTS;
  const c = COLORS[color];
  const cx = screen.x + screen.w / 2;
  const cy = screen.y + screen.h / 2;
  // 縦向きにしたときの画面の幅と高さ
  const pw = orientation === "portrait" ? screen.w : screen.h;
  const ph = orientation === "portrait" ? screen.h : screen.w;
  const r = s * P.radius;
  const grow = (d: number): Rect => ({ x: -pw / 2 - d, y: -ph / 2 - d, w: pw + d * 2, h: ph + d * 2 });
  const rect = (b: Rect, radius: number, fill: string): DrawOp => ({ type: "rect", ...place(b, cx, cy, orientation), r: radius, fill });

  const bezel = s * P.bezel;
  const band = s * P.band;
  const ring = s * P.ring;
  const edge = bezel + band;
  // 側面のボタン: 左に音量（1 本）、右に電源（短め）。帯から少しだけ出す
  const btn = s * P.button;
  const side = (left: boolean, from: number, to: number): DrawOp =>
    rect({ x: left ? -pw / 2 - edge - btn : pw / 2 + edge - btn, y: -ph / 2 + ph * from, w: btn * 2, h: ph * (to - from) }, btn, c.band);

  const back: DrawOp[] = [
    rect(grow(edge + ring), r + edge + ring, c.ring),
    side(true, 0.17, 0.3),
    side(false, 0.22, 0.31),
    rect(grow(edge), r + edge, c.band),
    rect(grow(bezel), r + bezel, c.bezel),
  ];
  // カメラの穴: 画面の上の真ん中（横向きなら左の真ん中）。ステータスバーの真ん中は時刻やアイコンのない場所
  const camR = s * P.camera;
  const cam = place({ x: -camR, y: -ph / 2 + s * P.cameraTop - camR, w: camR * 2, h: camR * 2 }, cx, cy, orientation);
  const camera = { cx: cam.x + camR, cy: cam.y + camR, r: camR };
  const front: DrawOp[] = [
    { type: "circle", cx: camera.cx, cy: camera.cy, r: camR, fill: CAMERA.hole },
    { type: "circle", cx: camera.cx, cy: camera.cy, r: camR * 0.42, fill: CAMERA.lens },
  ];
  return { back, front, screenR: r, camera };
}
