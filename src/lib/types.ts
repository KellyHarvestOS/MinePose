import type { EquippedItems } from "./items";

export type BodyPart = "head" | "body" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";
export type Rotation = { x: number; y: number; z: number };
export type Pose = Record<BodyPart, Rotation>;
export type SceneSettings = {
  background: string;
  floor: boolean;
  grid: boolean;
  light: number;
  skin: string;
  slim: boolean;
  sword: boolean;
  items?: EquippedItems;
  modelPosition?: Rotation;
  modelRotation?: Rotation;
  partOffsets?: Partial<Record<BodyPart, Rotation>>;
  previewCamera?: { azimuth: number; elevation: number };
};
// Kept only to read and back up projects saved before thumbnail editing was removed.
export type ThumbnailSettings = {
  title: string;
  subtitle: string;
  textColor: string;
  background: string;
  width: number;
  height: number;
  characterScale: number;
  characterX: number;
  headingImage?: string;
};
export type Project = {
  id: string;
  name: string;
  kind: "pose" | "thumbnail";
  updatedAt: number;
  pose: Pose;
  scene: SceneSettings;
  thumbnail?: ThumbnailSettings;
  preview?: string;
};
export const DEFAULT_POSE: Pose = {
  head: { x: 0, y: 0, z: 0 },
  body: { x: 0, y: 0, z: 0 },
  leftArm: { x: 0, y: 0, z: -5 },
  rightArm: { x: 0, y: 0, z: 5 },
  leftLeg: { x: 0, y: 0, z: 0 },
  rightLeg: { x: 0, y: 0, z: 0 }
};
export const DEFAULT_SCENE: SceneSettings = {
  background: "#21192d", floor: true, grid: true, partOffsets: {},
  light: 1.5, skin: "", slim: false, sword: false
};
export { PRESETS } from "./pose-presets";
export function makeProject(name = "Новая поза"): Project {
  return { id: crypto.randomUUID(), name, kind: "pose", updatedAt: Date.now(), pose: structuredClone(DEFAULT_POSE), scene: { ...DEFAULT_SCENE } };
}
