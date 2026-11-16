import { Euler, MathUtils, Quaternion } from "three";
import { DEFAULT_POSE, makeProject, type BodyPart, type Pose, type Project } from "./types";
import { getItemDefinition, makeEquippedItem } from "./items";
import type { AnimProperty, AnimValue, AnimationPreset, AnimationProject, AnimationTemplate, AnimationTrack, AnimationView, Easing, Keyframe, ParticleKind, StudioObject, Transform, Vec3 } from "./animation";

export const BODY_PARTS: BodyPart[] = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"];
export const defaultView: AnimationView = { projection: "perspective", view: "orbit", mode: "rotate", space: "local", snap: false, showGrid: true, showAxes: false, quality: "standard", ghostFrames: false };
export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const identityTransform = (): Transform => ({ position: vec(), rotation: vec(), scale: vec(1, 1, 1) });
const clone = <T,>(value: T): T => structuredClone(value);
const uid = () => crypto.randomUUID();
function object(type: StudioObject["type"], name: string): StudioObject { return { id: uid(), type, name, transform: identityTransform(), pivot: vec(), visible: true, locked: false, opacity: 1 }; }
export function createCharacter(skin = "", slim = false, name = "Персонаж"): StudioObject { return { ...object("character", name), character: { skin, slim, pose: clone(DEFAULT_POSE), outer: Object.fromEntries(BODY_PARTS.map(part => [part, true])) as Record<BodyPart, boolean>, lockedParts: [], rig: "classic" } }; }
export function createItem(catalogId: string): StudioObject { const definition = getItemDefinition(catalogId); if (!definition) throw new Error("Предмет не найден в каталоге"); return { ...object("item", definition.name), item: { catalogId } }; }
export function createGroup(): StudioObject { return object("group", "Группа"); }
export function createCamera(): StudioObject { const value = object("camera", "Камера"); value.transform.position = vec(4, 3, 6); value.camera = { projection: "perspective", fov: 40, zoom: 1, target: vec(0, 1, 0) }; return value; }
export function createLight(kind: NonNullable<StudioObject["light"]>["kind"] = "directional"): StudioObject { const value = object("light", "Свет"); value.transform.position = vec(-3, 6, 4); value.light = { kind, color: "#fff1dc", intensity: 2.5, castShadow: true, target: vec(0, 1, 0), distance: 20, angle: 35 }; return value; }
export function createParticle(kind: ParticleKind = "sparks"): StudioObject { return { ...object("particle", "Частицы"), emitter: { kind, color: "#c395ff", count: 45, size: .06, speed: 1, start: 0, duration: 4, seed: 177 } }; }
export function updateObject(project: AnimationProject, id: string, patch: Partial<StudioObject>): AnimationProject { return { ...project, updatedAt: Date.now(), objects: project.objects.map(value => value.id === id ? { ...value, ...patch, id: value.id } : value) }; }
export function getObjectProperty(value: StudioObject, property: AnimProperty): AnimValue {
  if (["position", "rotation", "scale"].includes(property)) return { ...value.transform[property as keyof Transform] };
  if (property === "pivot") return { ...value.pivot };
  if (property === "visible" || property === "opacity") return value[property];
  if (property === "parentId" || property === "attachment") return value[property] || "";
  if (property.startsWith("pose.")) return { ...(value.character?.pose[property.slice(5) as BodyPart] || vec()) };
  if (property.startsWith("camera.")) return clone(value.camera?.[property.slice(7) as "fov" | "zoom" | "target"] ?? 0);
  if (property.startsWith("light.")) return value.light?.[property.slice(6) as "intensity" | "color"] ?? 0;
  return value.emitter?.[property.slice(8) as "count" | "size" | "speed" | "color"] ?? 0;
}
export function setObjectProperty(source: StudioObject, property: AnimProperty, value: AnimValue): StudioObject {
  const next = { ...source };
  if (["position", "rotation", "scale"].includes(property)) next.transform = { ...source.transform, [property]: clone(value) };
  else if (property === "pivot") next.pivot = clone(value) as Vec3;
  else if (property === "visible") next.visible = Boolean(value);
  else if (property === "opacity") next.opacity = Number(value);
  else if (property === "parentId") next.parentId = String(value) || undefined;
  else if (property === "attachment") next.attachment = String(value) as StudioObject["attachment"] || undefined;
  else if (property.startsWith("pose.") && source.character) next.character = { ...source.character, pose: { ...source.character.pose, [property.slice(5)]: clone(value) } };
  else if (property.startsWith("camera.") && source.camera) next.camera = { ...source.camera, [property.slice(7)]: clone(value) };
  else if (property.startsWith("light.") && source.light) next.light = { ...source.light, [property.slice(6)]: value };
  else if (property.startsWith("emitter.") && source.emitter) next.emitter = { ...source.emitter, [property.slice(8)]: value };
  return next;
}
function bezierProgress(time: number, control: [number, number, number, number]) {
  const [x1, y1, x2, y2] = control;
  const point = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0, high = 1, parameter = time;
  for (let index = 0; index < 18; index++) { parameter = (low + high) / 2; if (point(parameter, x1, x2) < time) low = parameter; else high = parameter; }
  return point(parameter, y1, y2);
}
export function easingProgress(time: number, easing: Easing, bezier?: [number, number, number, number]) {
  const t = Math.max(0, Math.min(1, time));
  if (t === 0 || t === 1) return t;
  if (easing === "step") return t >= 1 ? 1 : 0;
  if (easing === "easeIn") return t * t;
  if (easing === "easeOut") return 1 - (1 - t) ** 2;
  if (easing === "easeInOut") return t * t * (3 - 2 * t);
  if (easing === "bezier") return bezierProgress(t, bezier || [.42, 0, .58, 1]);
  return t;
}
function quaternion(value: Vec3) { return new Quaternion().setFromEuler(new Euler(MathUtils.degToRad(value.x), MathUtils.degToRad(value.y), MathUtils.degToRad(value.z), "XYZ")); }
function fromQuaternion(value: Quaternion): Vec3 { const angle = new Euler().setFromQuaternion(value, "XYZ"); return vec(MathUtils.radToDeg(angle.x), MathUtils.radToDeg(angle.y), MathUtils.radToDeg(angle.z)); }
function interpolate(a: AnimValue, b: AnimValue, t: number, rotation: boolean): AnimValue {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * t;
  if (typeof a === "object" && typeof b === "object") {
    if (rotation) return fromQuaternion(quaternion(a).slerp(quaternion(b), t));
    return vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
  if (typeof a === "string" && typeof b === "string" && /^#[\da-f]{6}$/i.test(a) && /^#[\da-f]{6}$/i.test(b)) {
    const channel = (index: number) => Math.round(parseInt(a.slice(index, index + 2), 16) * (1 - t) + parseInt(b.slice(index, index + 2), 16) * t).toString(16).padStart(2, "0");
    return `#${channel(1)}${channel(3)}${channel(5)}`;
  }
  return t < 1 ? a : b;
}
export function sampleKeyframes(keys: Keyframe[], time: number, property: AnimProperty): AnimValue | undefined {
  if (!keys.length) return undefined;
  if (time <= keys[0].time) return clone(keys[0].value);
  if (time >= keys[keys.length - 1].time) return clone(keys[keys.length - 1].value);
  let low = 0, high = keys.length - 1;
  while (high - low > 1) { const mid = (low + high) >> 1; if (keys[mid].time <= time) low = mid; else high = mid; }
  const a = keys[low], b = keys[high];
  if (property === "visible" || property === "parentId" || property === "attachment") return clone(a.value);
  const progress = easingProgress((time - a.time) / Math.max(.000001, b.time - a.time), a.easing, a.bezier);
  return interpolate(a.value, b.value, progress, property === "rotation" || property.startsWith("pose."));
}
const compiled = new WeakMap<AnimationProject, { track: AnimationTrack; keys: Keyframe[] }[]>();
export function evaluateProject(project: AnimationProject, time: number): StudioObject[] {
  let tracks = compiled.get(project);
  if (!tracks) { tracks = project.tracks.map(track => ({ track, keys: [...track.keyframes].sort((a, b) => a.time - b.time) })); compiled.set(project, tracks); }
  const result = new Map(project.objects.map(value => [value.id, value]));
  for (const layer of project.layers) {
    if (!layer.enabled || layer.weight <= 0) continue;
    for (const { track, keys } of tracks) {
      if (track.layerId !== layer.id || track.muted || (track.start !== undefined && time < track.start) || (track.end !== undefined && time > track.end)) continue;
      if (layer.mask !== "all" && (!track.property.startsWith("pose.") || !layer.mask.includes(track.property.slice(5) as BodyPart))) continue;
      const current = result.get(track.objectId); if (!current) continue;
      const sampled = sampleKeyframes(keys, time, track.property); if (sampled === undefined) continue;
      const base = getObjectProperty(current, track.property);
      let value: AnimValue;
      if (layer.mode === "additive" && typeof base === "object" && typeof sampled === "object") {
        value = track.property === "rotation" || track.property.startsWith("pose.") ? fromQuaternion(quaternion(base).multiply(new Quaternion().slerp(quaternion(sampled), layer.weight))) : vec(base.x + sampled.x * layer.weight, base.y + sampled.y * layer.weight, base.z + sampled.z * layer.weight);
      } else if (layer.mode === "additive" && typeof base === "number" && typeof sampled === "number") value = base + sampled * layer.weight;
      else value = interpolate(base, sampled, layer.weight, track.property === "rotation" || track.property.startsWith("pose."));
      result.set(current.id, setObjectProperty(current, track.property, value));
    }
  }
  return project.objects.map(value => result.get(value.id)!);
}
export function upsertKeyframe(project: AnimationProject, objectId: string, property: AnimProperty, time: number, value: AnimValue, easing: Easing = "linear", layerId = "base"): AnimationProject {
  const target = project.objects.find(entry => entry.id === objectId); if (!target) return project;
  const at = Math.max(0, Math.min(project.duration, Math.round(time * project.fps) / project.fps));
  const tracks = project.tracks.map(track => ({ ...track, keyframes: track.keyframes.map(key => ({ ...key })) }));
  let track = tracks.find(entry => entry.objectId === objectId && entry.property === property && entry.layerId === layerId && entry.start === undefined);
  if (!track) { track = { id: uid(), objectId, property, layerId, keyframes: [], muted: false, locked: false }; if (at > 0) track.keyframes.push({ id: uid(), time: 0, value: getObjectProperty(target, property), easing }); tracks.push(track); }
  if (track.locked) return project;
  const existing = track.keyframes.find(entry => Math.abs(entry.time - at) < .5 / project.fps);
  if (existing) Object.assign(existing, { value: clone(value), easing });
  else track.keyframes.push({ id: uid(), time: at, value: clone(value), easing });
  track.keyframes.sort((a, b) => a.time - b.time);
  return { ...project, tracks, updatedAt: Date.now() };
}
export function mirrorPose(pose: Pose): Pose {
  const mirror = (value: Vec3) => vec(value.x, -value.y, -value.z);
  return { head: mirror(pose.head), body: mirror(pose.body), leftArm: mirror(pose.rightArm), rightArm: mirror(pose.leftArm), leftLeg: mirror(pose.rightLeg), rightLeg: mirror(pose.leftLeg) };
}

const definitions: [string, string, string, number, boolean][] = [
  ["idle", "Стояние", "Передвижение", 3, true], ["walk", "Ходьба", "Передвижение", 1.2, true], ["run", "Бег", "Передвижение", .8, true], ["sprint", "Спринт", "Передвижение", .6, true], ["jump", "Прыжок", "Передвижение", 1.2, false], ["sneak", "Приседание", "Передвижение", 1.5, true], ["crawl", "Ползание", "Передвижение", 2, true], ["swim", "Плавание", "Передвижение", 1.6, true], ["fly", "Полёт", "Передвижение", 2, true], ["fall", "Падение", "Передвижение", 1.2, false], ["climb", "Подъём", "Передвижение", 2, true],
  ["punch", "Удар рукой", "Действия", .7, false], ["sword", "Удар мечом", "Действия", 1, false], ["axe", "Замах топором", "Действия", 1.4, false], ["bow", "Стрельба из лука", "Действия", 2, false], ["crossbow", "Использование арбалета", "Действия", 1.4, false], ["dig", "Копание", "Действия", 1.5, true], ["mine", "Добыча блоков", "Действия", 1.2, true], ["place", "Размещение блока", "Действия", 1, false], ["pickup", "Поднятие предмета", "Действия", 1.5, false], ["use", "Использование предмета", "Действия", 1.4, false], ["drink", "Питьё зелья", "Действия", 2, false], ["eat", "Поедание еды", "Действия", 2, false], ["door", "Открывание двери", "Действия", 1.2, false],
  ["greeting", "Приветствие", "Эмоции", 1.5, false], ["wave", "Машет рукой", "Эмоции", 2, true], ["nod", "Кивает", "Эмоции", 1.2, true], ["shake", "Качает головой", "Эмоции", 1.4, true], ["joy", "Радуется", "Эмоции", 1.6, true], ["dance", "Танцует", "Эмоции", 3, true], ["surprise", "Удивляется", "Эмоции", 1.4, false], ["fear", "Боится", "Эмоции", 2, true], ["cry", "Плачет", "Эмоции", 2, true], ["laugh", "Смеётся", "Эмоции", 2, true], ["angry", "Злится", "Эмоции", 1.8, true], ["sit", "Садится", "Эмоции", 1.5, false], ["lie", "Ложится", "Эмоции", 1.8, false],
  ["attack", "Атака", "Бой", .8, false], ["combo", "Комбо-удары", "Бой", 2, false], ["block", "Блокирование", "Бой", 1.5, false], ["dodge", "Уклонение", "Бой", .9, false], ["hurt", "Получение урона", "Бой", .7, false], ["knockback", "Отбрасывание", "Бой", 1, false], ["defeat", "Падение после удара", "Бой", 1.8, false],
];
export const ANIMATION_PRESETS: AnimationPreset[] = definitions.map(([id, name, category, duration, loop]) => ({ id, name, category, duration, loop }));
function motion(id: string, u: number) {
  const pose = clone(DEFAULT_POSE), position = vec(), rotation = vec();
  const phase = u * Math.PI * 2, sine = Math.sin(phase), pulse = Math.sin(Math.PI * u), end = u * u * (3 - 2 * u);
  if (id === "idle") { pose.head.x = sine * 3; pose.leftArm.z -= sine * 2; pose.rightArm.z += sine * 2; position.y = sine * .018; }
  else if (["walk", "run", "sprint"].includes(id)) { const power = id === "walk" ? 32 : id === "run" ? 58 : 76; pose.rightLeg.x = sine * power; pose.leftLeg.x = -sine * power; pose.rightArm.x = -sine * power * .85; pose.leftArm.x = sine * power * .85; pose.body.x = id === "walk" ? 3 : id === "run" ? 12 : 20; pose.head.x = -pose.body.x / 2; position.y = Math.abs(sine) * .06; }
  else if (id === "jump") { position.y = pulse * 1.15; pose.leftArm.x = -pulse * 110; pose.rightArm.x = -pulse * 95; pose.leftLeg.x = -pulse * 45; pose.rightLeg.x = pulse * 28; pose.body.x = pulse * 10; }
  else if (id === "sneak") { position.y = -.22 * end; pose.body.x = 38 * end; pose.leftLeg.x = -45 * end; pose.rightLeg.x = -48 * end; pose.head.x = -12 * end; pose.leftArm.x = -40 * end; pose.rightArm.x = -36 * end; }
  else if (["crawl", "swim", "fly"].includes(id)) { rotation.x = id === "fly" ? 78 : 90; position.y = id === "crawl" ? .25 : id === "swim" ? 1.2 + sine * .1 : 1.6 + sine * .2; position.z = -.7; pose.leftArm.x = sine * (id === "fly" ? 18 : 65) - 100; pose.rightArm.x = -sine * (id === "fly" ? 18 : 65) - 100; pose.leftLeg.x = sine * 28; pose.rightLeg.x = -sine * 28; }
  else if (id === "fall") { position.y = (1 - u * u) * 1.6; pose.leftArm.z = 65; pose.rightArm.z = -65; pose.leftLeg.x = 22; pose.rightLeg.x = -30; pose.head.x = 20; }
  else if (id === "climb") { position.y = u * 1.5; pose.leftArm.x = -135 + sine * 30; pose.rightArm.x = -135 - sine * 30; pose.leftLeg.x = sine * 35; pose.rightLeg.x = -sine * 35; pose.head.x = -15; }
  else if (["punch", "sword", "axe", "attack", "combo"].includes(id)) { const hit = id === "combo" ? Math.sin(Math.PI * u * 3) : pulse; pose.rightArm.x = -hit * (id === "axe" ? 155 : id === "punch" ? 90 : 115); pose.rightArm.z = -hit * (id === "sword" ? 65 : 25); pose.rightArm.y = id === "punch" ? -hit * 18 : 0; pose.body.y = hit * (id === "punch" ? -16 : -30); pose.leftArm.x = -hit * 32; pose.head.y = hit * 15; if (id === "attack") { position.z = pulse * .5; pose.rightLeg.x = -pulse * 28; pose.leftLeg.x = pulse * 20; } }
  else if (id === "bow") { pose.body.y = -32; pose.head.y = 80; pose.leftArm.z = 90; pose.rightArm.z = 78 + pulse * 9; pose.rightArm.x = -15; }
  else if (id === "crossbow") { pose.rightArm.x = -90; pose.leftArm.x = -85; pose.leftArm.z = -38; pose.rightArm.z = 12; pose.head.x = -4; pose.rightArm.y = pulse * -8; }
  else if (["dig", "mine"].includes(id)) { pose.rightArm.x = -88 - sine * 55; pose.body.x = 10 + sine * 7; pose.leftArm.x = -35 - sine * 15; pose.head.x = 18; }
  else if (["place", "use", "door"].includes(id)) { pose.rightArm.x = -(id === "place" ? 65 : 95) * pulse; pose.body.y = (id === "door" ? -35 : -12) * pulse; pose.leftArm.z = -5 - pulse * 10; if (id === "door") pose.rightArm.y = -40 * pulse; if (id === "place") pose.head.x = 28 * pulse; if (id === "use") pose.rightArm.z = Math.sin(phase * 3) * pulse * 12; }
  else if (id === "pickup") { pose.body.x = pulse * 48; pose.head.x = pulse * 18; pose.rightArm.x = pulse * 18; position.y = -pulse * .08; }
  else if (["drink", "eat"].includes(id)) { pose.rightArm.x = -(id === "drink" ? 145 : 125) * pulse; pose.rightArm.z = 35 * pulse; pose.head.x = (id === "drink" ? -24 : 8) * pulse; pose.rightArm.y = Math.sin(u * Math.PI * (id === "drink" ? 4 : 12)) * pulse * (id === "drink" ? 3 : 8); }
  else if (["greeting", "wave"].includes(id)) { const raise = id === "greeting" ? pulse : .9; pose.rightArm.z = -145 * raise; pose.rightArm.x = Math.sin(phase * 2) * 18 * raise; pose.head.z = -5 * raise; }
  else if (id === "nod") pose.head.x = Math.sin(phase * 2) * 22;
  else if (id === "shake") pose.head.y = Math.sin(phase * 2) * 32;
  else if (id === "joy") { pose.leftArm.z = 145; pose.rightArm.z = -145; pose.head.x = -20; position.y = Math.abs(sine) * .24; }
  else if (id === "dance") { pose.body.y = sine * 24; pose.body.z = Math.cos(phase) * 9; pose.leftArm.x = sine * 70 - 40; pose.rightArm.x = -sine * 70 - 40; pose.leftLeg.x = sine * 30; pose.rightLeg.x = -sine * 30; position.y = Math.abs(Math.sin(phase * 2)) * .08; }
  else if (id === "surprise") { pose.head.x = -18 * pulse; pose.leftArm.z = 62 * pulse; pose.rightArm.z = -62 * pulse; pose.body.x = -10 * pulse; }
  else if (id === "fear") { pose.body.x = -8; pose.head.y = sine * 10; pose.leftArm.x = -100; pose.rightArm.x = -110; pose.leftArm.z = -28; pose.rightArm.z = 30; position.x = sine * .025; }
  else if (id === "cry") { pose.head.x = 28 + sine * 4; pose.leftArm.x = -115; pose.rightArm.x = -118; pose.leftArm.z = -30; pose.rightArm.z = 30; pose.body.x = sine * 3; }
  else if (id === "laugh") { pose.head.x = -15 + Math.sin(phase * 3) * 5; pose.body.x = Math.sin(phase * 3) * 5; pose.leftArm.x = -40; pose.rightArm.x = -35; }
  else if (id === "angry") { pose.head.x = 10; pose.body.x = 8; pose.rightArm.x = -sine * 20; pose.leftArm.x = sine * 20; pose.rightArm.z = -18; pose.leftArm.z = 18; }
  else if (id === "sit") { pose.leftLeg.x = -90 * end; pose.rightLeg.x = -90 * end; position.y = -.72 * end; pose.body.x = 8 * pulse; }
  else if (id === "lie") { rotation.x = 90 * end; position.y = .16 * end; position.z = -.7 * end; pose.leftArm.z = -3; pose.rightArm.z = 3; }
  else if (id === "block") { pose.leftArm.x = -75 * pulse; pose.leftArm.z = -15 * pulse; pose.rightArm.x = -40 * pulse; pose.body.x = -8 * pulse; }
  else if (id === "dodge") { position.x = -pulse * .9; pose.body.z = pulse * 30; pose.head.z = -pulse * 12; pose.leftLeg.z = pulse * 25; pose.rightLeg.z = -pulse * 20; }
  else if (id === "hurt") { pose.body.x = -pulse * 22; pose.head.x = -pulse * 18; pose.leftArm.z = pulse * 35; pose.rightArm.z = -pulse * 35; }
  else if (id === "knockback") { position.z = -u * 1.4; position.y = pulse * .4; rotation.x = -pulse * 30; pose.leftArm.z = 60; pose.rightArm.z = -60; }
  else if (id === "defeat") { rotation.x = -90 * end; position.z = -end * .5; position.y = end * .15; pose.leftArm.z = pulse * 40; pose.rightArm.z = -pulse * 40; }
  return { pose, position, rotation };
}
export function applyAnimationPreset(project: AnimationProject, objectId: string, presetId: string, start = 0, duration?: number, layerId?: string): AnimationProject {
  const object = project.objects.find(value => value.id === objectId), preset = ANIMATION_PRESETS.find(value => value.id === presetId);
  if (!object?.character || !preset) throw new Error("Выберите персонажа и движение");
  const length = Math.max(.1, duration ?? preset.duration), at = Math.max(0, start), end = at + length;
  const next = clone(project); next.duration = Math.max(next.duration, end); if (project.export.end === project.duration) next.export.end = next.duration;
  const layer = layerId || uid();
  if (!next.layers.some(value => value.id === layer)) next.layers.push({ id: layer, name: preset.name, enabled: true, weight: 1, mask: "all", mode: "override" });
  const parts = preset.id === "nod" || preset.id === "shake" ? ["head"] as BodyPart[] : preset.id === "wave" || preset.id === "greeting" ? ["rightArm", "head"] as BodyPart[] : BODY_PARTS;
  for (const property of [...parts.map(part => `pose.${part}` as AnimProperty), ...(parts.length === BODY_PARTS.length ? ["position", "rotation"] as AnimProperty[] : [])]) {
    const keys: Keyframe[] = [];
    for (let index = 0; index <= 24; index++) {
      const sample = motion(preset.id, index / 24);
      const value = property.startsWith("pose.") ? sample.pose[property.slice(5) as BodyPart] : property === "position" ? vec(object.transform.position.x + sample.position.x, object.transform.position.y + sample.position.y, object.transform.position.z + sample.position.z) : vec(object.transform.rotation.x + sample.rotation.x, object.transform.rotation.y + sample.rotation.y, object.transform.rotation.z + sample.rotation.z);
      keys.push({ id: uid(), time: at + index / 24 * length, value, easing: "linear" });
    }
    next.tracks.push({ id: uid(), objectId, property, layerId: layer, keyframes: keys, muted: false, locked: false, start: at, end });
  }
  const equipment: Record<string, [string, "left" | "right"]> = { sword: ["diamond_sword", "right"], attack: ["diamond_sword", "right"], combo: ["netherite_sword", "right"], axe: ["diamond_axe", "right"], bow: ["bow", "left"], crossbow: ["crossbow", "right"], dig: ["diamond_shovel", "right"], mine: ["diamond_pickaxe", "right"], place: ["grass_block", "right"], pickup: ["apple", "right"], drink: ["potion", "right"], eat: ["apple", "right"], block: ["shield", "left"] };
  const held = equipment[preset.id];
  if (held && !next.objects.some(value => value.parentId === objectId && value.attachment === `${held[1]}Arm`)) { const item = createItem(held[0]); item.parentId = objectId; item.attachment = `${held[1]}Arm`; item.item!.hand = held[1]; next.objects.push(item); }
  next.updatedAt = Date.now(); return next;
}
export function createAnimationProject(template: AnimationTemplate = "empty", skin = "", slim = false): AnimationProject {
  const character = createCharacter(skin, slim), camera = createCamera(), light = createLight();
  const names: Record<AnimationTemplate, string> = { empty: "Новая анимация", walk: "Анимация ходьбы", combat: "Боевая сцена", dance: "Танец", cinematic: "Кинематографическая сцена", gif: "Анимация для GIF" };
  let project: AnimationProject = { schemaVersion: 1, kind: "animation", id: uid(), name: names[template] || names.empty, fps: 30, duration: 4, objects: [character, camera, light], tracks: [], layers: [{ id: "base", name: "Основной слой", enabled: true, weight: 1, mask: "all", mode: "override" }], scene: { environment: "studio", background: "#21192d", transparent: false, floor: true, grid: true, axes: false, floorSize: 12, shadows: true, ambient: .8, activeCameraId: camera.id }, export: { format: "webm", width: 1280, height: 720, fps: 30, start: 0, end: 4, transparent: false, quality: .8, loop: true, audio: false, cameraId: camera.id }, updatedAt: Date.now() };
  if (template === "walk" || template === "dance" || template === "gif") project = applyAnimationPreset(project, character.id, template === "walk" ? "walk" : template === "dance" ? "dance" : "wave", 0, 4);
  if (template === "gif") { project.export = { ...project.export, format: "gif", width: 512, height: 512, transparent: true }; project.scene.transparent = true; }
  if (template === "combat") { character.transform.position.x = -.9; character.transform.rotation.y = 90; const other = createCharacter(skin, slim, "Соперник"); other.transform.position.x = .9; other.transform.rotation.y = -90; project.objects.push(other); project = applyAnimationPreset(project, character.id, "combo", 0, 4); project = applyAnimationPreset(project, other.id, "block", 0, 4); }
  if (template === "cinematic") { project.scene.environment = "forest"; project = applyAnimationPreset(project, character.id, "idle", 0, 4); project = upsertKeyframe(project, camera.id, "position", 0, vec(4, 2.5, 6), "easeInOut"); project = upsertKeyframe(project, camera.id, "position", 4, vec(-3, 2, 5), "easeInOut"); }
  return project;
}
export function poseToAnimationProject(pose: Project): AnimationProject {
  const project = createAnimationProject("empty", pose.scene.skin, pose.scene.slim); project.name = `${pose.name} — анимация`;
  const character = project.objects.find(value => value.character)!; character.character!.pose = clone(pose.pose);
  character.transform.position = vec((pose.scene.modelPosition?.x || 0) / 2, (pose.scene.modelPosition?.y || 0) / 2, (pose.scene.modelPosition?.z || 0) / 2); character.transform.rotation = clone(pose.scene.modelRotation || vec());
  for (const hand of ["right", "left"] as const) { const held = pose.scene.items?.[hand]; if (!held) continue; const item = createItem(held.id); item.parentId = character.id; item.attachment = `${hand}Arm`; item.item!.hand = hand; item.transform = { position: clone(held.transform.position), rotation: clone(held.transform.rotation), scale: vec(held.transform.scale, held.transform.scale, held.transform.scale) }; project.objects.push(item); }
  return project;
}
export function animationFrameToPose(project: AnimationProject, time: number, objectId: string): Project {
  const objects = evaluateProject(project, time), character = objects.find(value => value.id === objectId);
  if (!character?.character) throw new Error("Выберите персонажа, чтобы сохранить кадр как позу");
  const pose = makeProject(`${project.name} — ${time.toFixed(2)} с`); pose.pose = clone(character.character.pose); pose.scene.skin = character.character.skin; pose.scene.slim = character.character.slim; pose.scene.background = project.scene.background;
  pose.scene.modelPosition = vec(character.transform.position.x * 2, character.transform.position.y * 2, character.transform.position.z * 2); pose.scene.modelRotation = clone(character.transform.rotation); pose.scene.items = { right: null, left: null };
  for (const hand of ["right", "left"] as const) { const held = objects.find(value => value.item && value.parentId === objectId && value.attachment === `${hand}Arm`); if (!held?.item) continue; const entry = makeEquippedItem(held.item.catalogId); entry.transform.position = clone(held.transform.position); entry.transform.rotation = clone(held.transform.rotation); entry.transform.scale = held.transform.scale.x; pose.scene.items[hand] = entry; }
  return pose;
}

export { parseAnimationProject } from "./animation-validation";
