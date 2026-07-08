export interface AccentPreset {
  name: string;
  color: string;
}

// 기본은 파스텔 그린. 사용자가 상단 색 선택기로 변경 가능(로컬 저장).
export const ACCENT_PRESETS: AccentPreset[] = [
  { name: "Green", color: "#7fd6a6" },
  { name: "Mint", color: "#8fe3c6" },
  { name: "Teal", color: "#83d6cf" },
  { name: "Blue", color: "#8fb8f2" },
  { name: "Violet", color: "#c0aeec" },
  { name: "Amber", color: "#f2d29a" },
  { name: "Rose", color: "#f2a8b8" },
];

const STORAGE_KEY = "soundlib.accent";

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lighten([r, g, b]: [number, number, number], amt: number): string {
  const f = (c: number): number => Math.round(c + (255 - c) * amt);
  return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
}

export function applyAccent(hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  const s = document.documentElement.style;
  s.setProperty("--accent", hex);
  s.setProperty("--accent-bright", lighten([r, g, b], 0.22));
  s.setProperty("--accent-dim", `rgba(${r}, ${g}, ${b}, 0.16)`);
  s.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.4)`);
  s.setProperty("--surface-active", `rgba(${r}, ${g}, ${b}, 0.13)`);
}

export function loadAccent(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ACCENT_PRESETS[0].color;
}

export function saveAccent(hex: string): void {
  localStorage.setItem(STORAGE_KEY, hex);
}
