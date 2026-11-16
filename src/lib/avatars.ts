import { DEFAULT_POSE, type Pose } from "./types";

export type AvatarShot = "portrait" | "head" | "full" | "mini";
export type AvatarPresetId = "portrait" | "head" | "mini" | "confident";
export type AvatarBackground = "solid" | "gradient" | "transparent";
export type AvatarSettings = {
  preset: AvatarPresetId;
  pose: Pose;
  skin: string;
  skinName: string;
  slim: boolean;
  background: AvatarBackground;
  color: string;
  endColor: string;
  frame: boolean;
  frameColor: string;
  frameWidth: number;
  round: boolean;
  zoom: number;
  resolution: 512 | 1024 | 2048;
};

const standing: Pose = structuredClone(DEFAULT_POSE);
const confident: Pose = {
  ...structuredClone(DEFAULT_POSE),
  head: { x: 0, y: -8, z: 0 },
  leftArm: { x: -65, y: -12, z: -48 },
  rightArm: { x: -65, y: 12, z: 48 },
};
export const AVATAR_PRESETS: { id: AvatarPresetId; label: string; caption: string; shot: AvatarShot; pose: Pose; color: string; endColor: string; frame: boolean }[] = [
  { id: "portrait", label: "Портрет", caption: "Твой новый профиль", shot: "portrait", pose: standing, color: "#9955d7", endColor: "#35234e", frame: true },
  { id: "head", label: "Голова", caption: "Только самое главное", shot: "head", pose: standing, color: "#4c8ee5", endColor: "#202b58", frame: false },
  { id: "mini", label: "Мини", caption: "Маленький герой", shot: "mini", pose: standing, color: "#c992f0", endColor: "#4f2a83", frame: false },
  { id: "confident", label: "Уверенная поза", caption: "С характером", shot: "portrait", pose: confident, color: "#35313f", endColor: "#141119", frame: false },
];
export const DEFAULT_AVATAR: AvatarSettings = {
  preset: "portrait", pose: structuredClone(standing), skin: "", skinName: "Путешественник", slim: false,
  background: "gradient", color: "#9955d7", endColor: "#35234e", frame: true,
  frameColor: "#ffffff", frameWidth: 24, round: false, zoom: 100, resolution: 1024,
};
