export type HeadingFontId = "minecraft" | "pixelify" | "retro" | "tiny" | "block" | "techno" | "massive" | "clean";

export const HEADING_FONTS: { id: HeadingFontId; label: string; family: string; weight: number; pixel: boolean }[] = [
  { id: "minecraft", label: "Minecraft", family: "Monocraft", weight: 400, pixel: true },
  { id: "pixelify", label: "Pixelify", family: "Pixelify Sans Variable", weight: 600, pixel: true },
  { id: "retro", label: "Ретро 8-bit", family: "Press Start 2P", weight: 400, pixel: true },
  { id: "tiny", label: "Tiny5", family: "Tiny5", weight: 400, pixel: true },
  { id: "block", label: "Блочный", family: "Russo One", weight: 400, pixel: false },
  { id: "techno", label: "Техно", family: "Tektur Variable", weight: 700, pixel: false },
  { id: "massive", label: "Массивный", family: "Rubik Mono One", weight: 400, pixel: false },
  { id: "clean", label: "Чистый", family: "Golos Text Variable", weight: 800, pixel: false },
];

export type HeadingOptions = {
  text: string;
  font: HeadingFontId;
  color: string;
  endColor: string;
  gradient: boolean;
  outlineColor: string;
  outlineWidth: number;
  depth: number;
  size: number;
  letterSpacing: number;
  background: string;
  transparent: boolean;
};

export const DEFAULT_HEADING: HeadingOptions = {
  text: "DAY 100", font: "minecraft", color: "#ffffff", endColor: "#a56bea",
  gradient: false, outlineColor: "#24202d", outlineWidth: 1, depth: 3,
  size: 100, letterSpacing: 0, background: "#1a1522", transparent: true,
};
