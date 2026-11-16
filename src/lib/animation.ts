import type { BodyPart, Pose } from "./types";

export type Vec3 = { x: number; y: number; z: number };
export type Transform = { position: Vec3; rotation: Vec3; scale: Vec3 };
export type Easing = "step" | "linear" | "easeIn" | "easeOut" | "easeInOut" | "bezier";
export type AnimValue = number | boolean | string | Vec3;
export type AnimProperty = "position" | "rotation" | "scale" | "pivot" | "visible" | "opacity" | "parentId" | "attachment" | `pose.${BodyPart}` | "camera.fov" | "camera.zoom" | "camera.target" | "light.intensity" | "light.color" | "emitter.count" | "emitter.size" | "emitter.speed" | "emitter.color";
export type Keyframe = { id: string; time: number; value: AnimValue; easing: Easing; bezier?: [number, number, number, number] };
export type AnimationTrack = { id: string; objectId: string; property: AnimProperty; layerId: string; keyframes: Keyframe[]; muted: boolean; locked: boolean; start?: number; end?: number };
export type AnimationLayer = { id: string; name: string; enabled: boolean; weight: number; mask: "all" | BodyPart[]; mode: "override" | "additive" };
export type EnvironmentId = "empty" | "plains" | "forest" | "desert" | "snow" | "cave" | "nether" | "end" | "sky" | "studio";
export type ObjectType = "character" | "item" | "group" | "camera" | "light" | "particle" | "audio" | "model";
export type ParticleKind = "fire" | "smoke" | "sparks" | "dust" | "explosion" | "portal" | "magic" | "stars" | "hearts" | "water" | "rain" | "snow" | "trail";
export type StudioObject = {
  id: string; type: ObjectType; name: string; parentId?: string; attachment?: BodyPart | "back" | "root";
  transform: Transform; pivot: Vec3; visible: boolean; locked: boolean; opacity: number;
  character?: { skin: string; slim: boolean; pose: Pose; outer: Record<BodyPart, boolean>; lockedParts: BodyPart[]; rig: "classic"; cape?: string };
  item?: { catalogId: string; hand?: "right" | "left" };
  camera?: { projection: "perspective" | "orthographic"; fov: number; zoom: number; target: Vec3; followId?: string };
  light?: { kind: "ambient" | "directional" | "point" | "spot"; color: string; intensity: number; castShadow: boolean; target: Vec3; distance: number; angle: number };
  emitter?: { kind: ParticleKind; color: string; count: number; size: number; speed: number; start: number; duration: number; seed: number };
  audio?: { dataUrl: string; duration: number; offset: number; trimStart: number; trimEnd: number; volume: number; fadeIn: number; fadeOut: number; muted: boolean; peaks: number[] };
  model?: { dataUrl: string };
};
export type ExportFormat = "gif" | "webm" | "mp4" | "png-sequence" | "png" | "minepose";
export type AnimationExportSettings = { format: ExportFormat; width: number; height: number; fps: 24 | 30 | 60; start: number; end: number; transparent: boolean; quality: number; cameraId?: string; loop: boolean; audio: boolean };
export type AnimationScene = { environment: EnvironmentId; background: string; transparent: boolean; floor: boolean; grid: boolean; axes: boolean; floorSize: number; shadows: boolean; ambient: number; activeCameraId?: string };
export type AnimationProject = { schemaVersion: 1; kind: "animation"; id: string; name: string; fps: 24 | 30 | 60; duration: number; objects: StudioObject[]; tracks: AnimationTrack[]; layers: AnimationLayer[]; scene: AnimationScene; export: AnimationExportSettings; updatedAt: number };
export type AnimationSelection = { objectId: string; part?: BodyPart };
export type AnimationView = { projection: "perspective" | "orthographic"; view: "orbit" | "front" | "back" | "left" | "right" | "top" | "camera"; mode: "translate" | "rotate" | "scale"; space: "local" | "world"; snap: boolean; showGrid: boolean; showAxes: boolean; quality: "low" | "standard" | "high"; cameraId?: string; ghostFrames: boolean };
export type AnimationTemplate = "empty" | "walk" | "combat" | "dance" | "cinematic" | "gif";
export type AnimationPreset = { id: string; name: string; category: string; duration: number; loop: boolean };

export * from "./animation-engine";
