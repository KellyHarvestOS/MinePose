import { DEFAULT_POSE, DEFAULT_SCENE, type Project, type BodyPart } from "./types";
import { parseEquippedItems } from "./items";

export const STORAGE_KEY = "minepose-projects-v1";
const parts: BodyPart[] = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"];

export function parseProject(value: unknown): Project {
  if (!value || typeof value !== "object") throw new Error("Файл не содержит проект MinePose");
  const p = value as Record<string, unknown>;
  if ((p.kind !== "pose" && p.kind !== "thumbnail") || typeof p.name !== "string" || !p.pose || !p.scene) throw new Error("Выберите JSON-проект, экспортированный из MinePose");
  const pose = structuredClone(DEFAULT_POSE);
  for (const part of parts) {
    const rotation = (p.pose as Record<string, Record<string, unknown>>)[part];
    if (!rotation || ["x", "y", "z"].some(axis => typeof rotation[axis] !== "number" || !Number.isFinite(rotation[axis]) || Math.abs(rotation[axis] as number) > 360)) throw new Error("Некорректные углы поворота в проекте");
    pose[part] = { x: rotation.x as number, y: rotation.y as number, z: rotation.z as number };
  }
  const source = p.scene as Record<string, unknown>;
  const scene = { ...DEFAULT_SCENE };
  for (const field of ["floor", "grid", "slim", "sword"] as const) if (typeof source[field] === "boolean") scene[field] = source[field];
  scene.items = parseEquippedItems(source.items, scene.sword);
  scene.sword = false;
  if (typeof source.background === "string" && (/^#[0-9a-f]{6}$/i.test(source.background) || source.background === "transparent")) scene.background = source.background;
  if (typeof source.light === "number" && Number.isFinite(source.light)) scene.light = Math.min(5, Math.max(.1, source.light));
  if (typeof source.skin === "string" && /^data:image\/png;base64,/.test(source.skin) && source.skin.length < 3_000_000) scene.skin = source.skin;
  for (const field of ["modelPosition", "modelRotation"] as const) {
    if (source[field] === undefined) continue;
    const vector = source[field] as Record<string, unknown>;
    if (!vector || typeof vector !== "object" || Array.isArray(vector) || ["x", "y", "z"].some(axis => typeof vector[axis] !== "number" || !Number.isFinite(vector[axis]) || Math.abs(vector[axis] as number) > (field === "modelPosition" ? 32 : 360))) throw new Error("Некорректное положение персонажа в проекте");
    scene[field] = { x: vector.x as number, y: vector.y as number, z: vector.z as number };
  }
  if (source.previewCamera !== undefined) {
    const camera = source.previewCamera as Record<string, unknown>;
    if (!camera || typeof camera !== "object" || typeof camera.azimuth !== "number" || !Number.isFinite(camera.azimuth) || Math.abs(camera.azimuth) > 360 || typeof camera.elevation !== "number" || !Number.isFinite(camera.elevation) || Math.abs(camera.elevation) > 85) throw new Error("Некорректный ракурс персонажа в проекте");
    scene.previewCamera = { azimuth: camera.azimuth, elevation: camera.elevation };
  }
  const project: Project = { id: typeof p.id === "string" ? p.id : crypto.randomUUID(), name: p.name.slice(0, 100), kind: p.kind, updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(), pose, scene };
  if (typeof p.preview === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(p.preview) && p.preview.length < 3_000_000) project.preview = p.preview;
  if (p.kind === "thumbnail") {
    const t = (p.thumbnail || {}) as Record<string, unknown>;
    const formats = [[1280, 720], [720, 1280], [1080, 1080]];
    const format = formats.find(([w, h]) => t.width === w && t.height === h) || formats[0];
    project.thumbnail = { title: typeof t.title === "string" ? t.title.slice(0, 120) : "100 ДНЕЙ", subtitle: typeof t.subtitle === "string" ? t.subtitle.slice(0, 120) : "В МОЁМ МИРЕ", textColor: typeof t.textColor === "string" && /^#[0-9a-f]{6}$/i.test(t.textColor) ? t.textColor : "#ffffff", background: typeof t.background === "string" && /^#[0-9a-f]{6}$/i.test(t.background) ? t.background : "#7050c7", width: format[0], height: format[1], characterScale: typeof t.characterScale === "number" && Number.isFinite(t.characterScale) ? Math.max(.5, Math.min(1.6, t.characterScale)) : 1, characterX: typeof t.characterX === "number" && Number.isFinite(t.characterX) ? Math.max(-45, Math.min(20, t.characterX)) : 0 };
    if (typeof t.headingImage === "string" && t.headingImage.length <= 3_000_000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(t.headingImage)) project.thumbnail.headingImage = t.headingImage;
  }
  return project;
}
export function loadProjects(): Project[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("Не удалось прочитать локальные проекты");
  return data.map(parseProject).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function storeProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}
