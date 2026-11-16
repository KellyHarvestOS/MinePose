import { getItemDefinition } from "./items";
import { DEFAULT_POSE, type BodyPart } from "./types";
import type { AnimProperty, AnimValue, AnimationProject, Easing, Keyframe, StudioObject, Vec3 } from "./animation";

const parts: BodyPart[] = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"];
const properties = new Set<AnimProperty>(["position", "rotation", "scale", "pivot", "visible", "opacity", "parentId", "attachment", ...parts.map(part => `pose.${part}` as AnimProperty), "camera.fov", "camera.zoom", "camera.target", "light.intensity", "light.color", "emitter.count", "emitter.size", "emitter.speed", "emitter.color"]);
const easings: Easing[] = ["step", "linear", "easeIn", "easeOut", "easeInOut", "bezier"];
function record(value: unknown, label = "данные"): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Некорректные ${label} Animation Studio`); return value as Record<string, unknown>; }
function text(value: unknown, label: string, max = 100): string { if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Некорректное поле: ${label}`); return value; }
function number(value: unknown, label: string, min: number, max: number): number { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Значение «${label}» вне допустимого диапазона`); return value; }
function boolean(value: unknown, fallback = false): boolean { if (value === undefined) return fallback; if (typeof value !== "boolean") throw new Error("Некорректный переключатель проекта"); return value; }
function vector(value: unknown, label: string, min = -1000, max = 1000): Vec3 { const source = record(value, label); return { x: number(source.x, label, min, max), y: number(source.y, label, min, max), z: number(source.z, label, min, max) }; }
function list(value: unknown, label: string, limit: number): unknown[] { if (!Array.isArray(value) || value.length > limit) throw new Error(`Некорректный список: ${label}`); return value; }
function oneOf<T extends string>(value: unknown, variants: readonly T[], label: string): T { if (!variants.includes(value as T)) throw new Error(`Неизвестное значение: ${label}`); return value as T; }
function color(value: unknown): string { if (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value)) throw new Error("Некорректный цвет проекта"); return value; }
function skin(value: unknown): string {
  if (value === "") return "";
  if (typeof value !== "string" || value.length > 3_000_000 || !/^data:image\/png;base64,iVBORw0KGgo/.test(value)) throw new Error("Некорректный PNG-скин проекта");
  try { const data = Uint8Array.from(atob(value.split(",")[1].slice(0, 44)), char => char.charCodeAt(0)); const view = new DataView(data.buffer); if (view.getUint32(16) !== 64 || ![32, 64].includes(view.getUint32(20))) throw new Error(); }
  catch { throw new Error("Скин проекта должен иметь размер 64 × 64 или 64 × 32"); }
  return value;
}
function embeddedModel(value: unknown): string {
  if (typeof value !== "string" || value.length > 40_000_000 || !/^data:(model\/gltf-binary|application\/octet-stream);base64,/.test(value)) throw new Error("Выберите встроенную GLB-модель");
  try {
    const bytes = Uint8Array.from(atob(value.slice(value.indexOf(",") + 1)), character => character.charCodeAt(0)), view = new DataView(bytes.buffer);
    if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) throw new Error();
    let offset = 12, document: Record<string, unknown> | undefined, binaryLength = 0;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error();
      const size = view.getUint32(offset, true), type = view.getUint32(offset + 4, true); offset += 8;
      if (size % 4 || offset + size > bytes.length) throw new Error();
      if (!document) { if (type !== 0x4e4f534a) throw new Error(); document = record(JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + size)).trim()), "GLB"); }
      else if (type === 0x004e4942) { if (binaryLength) throw new Error(); binaryLength = size; }
      offset += size;
    }
    if (!document || record(document.asset, "GLB asset").version !== "2.0") throw new Error();
    const buffers = document.buffers === undefined ? [] : list(document.buffers, "GLB buffers", 1000);
    for (const [index, raw] of buffers.entries()) {
      const buffer = record(raw, "GLB buffer"), length = number(buffer.byteLength, "размер GLB buffer", 0, bytes.length);
      if (buffer.uri !== undefined) { if (typeof buffer.uri !== "string" || !buffer.uri.startsWith("data:")) throw new Error(); }
      else if (index !== 0 || length > binaryLength) throw new Error();
    }
    for (const raw of document.images === undefined ? [] : list(document.images, "GLB images", 1000)) { const image = record(raw, "GLB image"); if (image.uri !== undefined && (typeof image.uri !== "string" || !image.uri.startsWith("data:image/"))) throw new Error(); }
    if (Array.isArray(document.extensionsRequired) && document.extensionsRequired.some(extension => ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"].includes(String(extension)))) throw new Error();
  } catch { throw new Error("Нужна корректная GLB 2.0-модель со встроенными текстурами и геометрией, без внешних файлов и сжатия Draco / Meshopt / KTX2"); }
  return value;
}
function valueFor(property: AnimProperty, value: unknown): AnimValue {
  if (["position", "rotation", "scale", "pivot", "camera.target"].includes(property) || property.startsWith("pose.")) { const limit = property === "pivot" ? 100 : property === "rotation" || property.startsWith("pose.") ? 36000 : 1000; return vector(value, property, property === "scale" ? .001 : -limit, property === "scale" ? 100 : limit); }
  if (property === "visible") return boolean(value);
  if (property === "parentId") { if (value === "") return ""; return text(value, property, 80); }
  if (property === "attachment") return oneOf(value, ["", ...parts, "back", "root"], "точка крепления ключа");
  if (property.endsWith("color")) return color(value);
  const limits: Partial<Record<AnimProperty, [number, number]>> = { opacity: [0, 1], "camera.fov": [5, 150], "camera.zoom": [.1, 100], "light.intensity": [0, 100], "emitter.count": [0, 10000], "emitter.size": [.001, 10], "emitter.speed": [0, 100] };
  const [min, max] = limits[property] || [0, 10000]; return number(value, property, min, max);
}
export function parseAnimationProject(input: unknown): AnimationProject {
  const source = record(input, "данные проекта");
  if (source.kind !== "animation" || source.schemaVersion !== 1) throw new Error("Выберите проект Animation Studio версии 1 (.minepose или JSON)");
  const duration = number(source.duration, "длительность", .1, 600), fps = number(source.fps, "FPS", 24, 60);
  if (![24, 30, 60].includes(fps)) throw new Error("Поддерживаются 24, 30 и 60 FPS");
  const ids = new Set<string>();
  const objects: StudioObject[] = list(source.objects, "объекты", 1000).map(raw => {
    const item = record(raw, "настройки объекта"), id = text(item.id, "ID объекта", 80);
    if (ids.has(id)) throw new Error("В проекте повторяется ID объекта"); ids.add(id);
    const type = oneOf(item.type, ["character", "item", "group", "camera", "light", "particle", "audio", "model"], "тип объекта");
    const transform = record(item.transform, "трансформации объекта");
    const result: StudioObject = { id, type, name: text(item.name, "имя объекта"), transform: { position: vector(transform.position, "позиция"), rotation: vector(transform.rotation, "вращение", -36000, 36000), scale: vector(transform.scale, "масштаб", .001, 100) }, pivot: item.pivot ? vector(item.pivot, "центр вращения", -100, 100) : { x: 0, y: 0, z: 0 }, visible: boolean(item.visible, true), locked: boolean(item.locked), opacity: number(item.opacity ?? 1, "прозрачность", 0, 1) };
    if (item.parentId) result.parentId = text(item.parentId, "родитель", 80);
    if (item.attachment) result.attachment = oneOf<BodyPart | "back" | "root"> (item.attachment, [...parts, "back", "root"], "точка крепления");
    if (type === "character") {
      const character = record(item.character, "персонаж"), poseSource = record(character.pose, "поза"), pose = structuredClone(DEFAULT_POSE), outerSource = record(character.outer, "внешние слои");
      for (const part of parts) pose[part] = vector(poseSource[part], part, -36000, 36000);
      result.character = { skin: skin(character.skin), slim: boolean(character.slim), pose, outer: Object.fromEntries(parts.map(part => [part, boolean(outerSource[part], true)])) as Record<BodyPart, boolean>, lockedParts: character.lockedParts ? list(character.lockedParts, "блокировка суставов", 6).map(value => oneOf(value, parts, "сустав")) : [], rig: oneOf(character.rig || "classic", ["classic"], "риг") };
      if (character.cape) { if (typeof character.cape !== "string" || character.cape.length > 3_000_000 || !character.cape.startsWith("data:image/png;base64,")) throw new Error("Некорректная текстура плаща"); result.character.cape = character.cape; }
    }
    if (type === "item") { const entry = record(item.item, "предмет"); const catalogId = text(entry.catalogId, "предмет"); if (!getItemDefinition(catalogId)) throw new Error("Предмет отсутствует в каталоге MinePose"); result.item = { catalogId }; if (entry.hand) result.item.hand = oneOf(entry.hand, ["left", "right"] as const, "рука предмета"); }
    if (type === "camera") { const camera = record(item.camera, "камера"); result.camera = { projection: oneOf(camera.projection, ["perspective", "orthographic"], "проекция камеры"), fov: number(camera.fov, "FOV", 5, 150), zoom: number(camera.zoom, "масштаб камеры", .1, 100), target: vector(camera.target, "цель камеры") }; if (camera.followId) result.camera.followId = text(camera.followId, "цель слежения", 80); }
    if (type === "light") { const light = record(item.light, "свет"); result.light = { kind: oneOf(light.kind, ["ambient", "directional", "point", "spot"], "вид света"), color: color(light.color), intensity: number(light.intensity, "интенсивность", 0, 100), castShadow: boolean(light.castShadow), target: vector(light.target, "направление света"), distance: number(light.distance, "дальность света", 0, 1000), angle: number(light.angle, "угол света", 1, 89) }; }
    if (type === "particle") { const emitter = record(item.emitter, "частицы"); result.emitter = { kind: oneOf(emitter.kind, ["fire", "smoke", "sparks", "dust", "explosion", "portal", "magic", "stars", "hearts", "water", "rain", "snow", "trail"], "эффект"), color: color(emitter.color), count: number(emitter.count, "количество частиц", 0, 10000), size: number(emitter.size, "размер частиц", .001, 10), speed: number(emitter.speed, "скорость частиц", 0, 100), start: number(emitter.start, "запуск эффекта", 0, 600), duration: number(emitter.duration, "длительность эффекта", .01, 600), seed: number(emitter.seed, "seed эффекта", 0, 2147483647) }; }
    if (type === "audio") { const audio = record(item.audio, "аудиодорожка"); if (typeof audio.dataUrl !== "string" || audio.dataUrl.length > 40_000_000 || !/^data:audio\/[\w.+-]+;base64,/.test(audio.dataUrl)) throw new Error("Некорректный аудиофайл проекта"); result.audio = { dataUrl: audio.dataUrl, duration: number(audio.duration, "длительность аудио", .01, 3600), offset: number(audio.offset, "начало аудио", 0, 600), trimStart: number(audio.trimStart, "обрезка начала", 0, 3600), trimEnd: number(audio.trimEnd, "обрезка конца", 0, 3600), volume: number(audio.volume, "громкость", 0, 2), fadeIn: number(audio.fadeIn, "появление звука", 0, 600), fadeOut: number(audio.fadeOut, "затухание звука", 0, 600), muted: boolean(audio.muted), peaks: list(audio.peaks, "волна звука", 4096).map(value => number(value, "уровень волны", 0, 1)) }; }
    if (type === "model") result.model = { dataUrl: embeddedModel(record(item.model, "GLB-модель").dataUrl) };
    return result;
  });
  function checkHierarchy(entries: StudioObject[]) { const byId = new Map(entries.map(value => [value.id, value])), checked = new Set<string>(); for (const item of entries) { if (checked.has(item.id)) continue; const seen = new Set<string>(); let current: string | undefined = item.id; while (current && !checked.has(current)) { if (!byId.has(current) || seen.has(current)) throw new Error("Иерархия содержит цикл или неизвестного родителя"); seen.add(current); current = byId.get(current)!.parentId; } for (const id of seen) checked.add(id); } }
  checkHierarchy(objects);
  for (const value of objects) if (value.camera?.followId && !ids.has(value.camera.followId)) throw new Error("Цель слежения камеры не найдена");
  const layerIds = new Set<string>();
  const layers = list(source.layers, "слои", 200).map(raw => { const layer = record(raw, "слой"), id = text(layer.id, "ID слоя", 80); if (layerIds.has(id)) throw new Error("Повторяется ID слоя"); layerIds.add(id); return { id, name: text(layer.name, "имя слоя"), enabled: boolean(layer.enabled, true), weight: number(layer.weight, "вес слоя", 0, 1), mask: layer.mask === "all" ? "all" as const : list(layer.mask, "маска", 6).map(value => oneOf(value, parts, "маска части тела")), mode: oneOf(layer.mode, ["override", "additive"], "смешивание") }; });
  if (!layers.length) throw new Error("В проекте должен быть хотя бы один слой");
  let keyCount = 0; const trackIds = new Set<string>(), keyIds = new Set<string>();
  const tracks = list(source.tracks, "дорожки", 10000).map(raw => {
    const track = record(raw, "дорожка"), id = text(track.id, "ID дорожки", 80), objectId = text(track.objectId, "объект дорожки", 80), layerId = text(track.layerId, "слой дорожки", 80), property = track.property as AnimProperty;
    if (trackIds.has(id) || !ids.has(objectId) || !layerIds.has(layerId) || !properties.has(property)) throw new Error("Некорректная дорожка анимации"); trackIds.add(id);
    const target = objects.find(value => value.id === objectId)!;
    if (property.startsWith("pose.") && !target.character || property.startsWith("camera.") && !target.camera || property.startsWith("light.") && !target.light || property.startsWith("emitter.") && !target.emitter) throw new Error("Свойство дорожки не подходит выбранному объекту");
    const keyframes: Keyframe[] = list(track.keyframes, "ключи", 20000).map(rawKey => { const key = record(rawKey, "ключевой кадр"), keyId = text(key.id, "ID ключа", 80); if (keyIds.has(keyId) || ++keyCount > 200000) throw new Error("Повторяющийся ключ или слишком большой проект"); keyIds.add(keyId); const result: Keyframe = { id: keyId, time: number(key.time, "время ключа", 0, duration), value: valueFor(property, key.value), easing: oneOf(key.easing, easings, "интерполяция") }; if (key.bezier) { const curve = list(key.bezier, "Bezier", 4); if (curve.length !== 4) throw new Error("Кривая Bezier должна содержать четыре значения"); result.bezier = [number(curve[0], "Bezier X1", 0, 1), number(curve[1], "Bezier Y1", -2, 2), number(curve[2], "Bezier X2", 0, 1), number(curve[3], "Bezier Y2", -2, 2)]; } return result; }).sort((a, b) => a.time - b.time);
    for (let index = 1; index < keyframes.length; index++) if (keyframes[index].time === keyframes[index - 1].time) throw new Error("Два ключа одной дорожки не могут находиться в одном времени");
    const result = { id, objectId, property, layerId, keyframes, muted: boolean(track.muted), locked: boolean(track.locked), start: track.start === undefined ? undefined : number(track.start, "начало клипа", 0, duration), end: track.end === undefined ? undefined : number(track.end, "конец клипа", 0, duration) };
    if (result.start !== undefined && result.end !== undefined && result.start > result.end) throw new Error("Некорректные границы клипа");
    if (property === "parentId" && keyframes.some(key => key.value !== "" && (!ids.has(String(key.value)) || key.value === objectId))) throw new Error("Неверный родитель в ключевом кадре");
    return result;
  });
  const parentTracks = tracks.filter(track => track.property === "parentId" && !track.muted);
  if (parentTracks.length) {
    const times = new Set<number>([0, duration]);
    for (const track of parentTracks) for (const time of [track.start, track.end, ...track.keyframes.map(key => key.time)]) if (time !== undefined) { times.add(time); if (time > 0) times.add(Math.max(0, time - .000001)); if (time < duration) times.add(Math.min(duration, time + .000001)); }
    if (parentTracks.length > 1000 || times.size > 15000) throw new Error("Слишком много изменений иерархии в проекте");
    for (const time of times) {
      const parents = new Map(objects.map(value => [value.id, value.parentId]));
      for (const layer of layers) if (layer.enabled && layer.weight === 1 && layer.mask === "all") for (const track of parentTracks) {
        if (track.layerId !== layer.id || !track.keyframes.length || track.start !== undefined && time < track.start || track.end !== undefined && time > track.end) continue;
        let key = track.keyframes[0]; for (const candidate of track.keyframes) { if (candidate.time > time) break; key = candidate; }
        parents.set(track.objectId, String(key.value) || undefined);
      }
      checkHierarchy(objects.map(value => ({ ...value, parentId: parents.get(value.id) })));
    }
  }
  const scene = record(source.scene, "сцена"), settings = record(source.export, "экспорт");
  const exportFps = number(settings.fps, "FPS экспорта", 24, 60); if (![24, 30, 60].includes(exportFps)) throw new Error("Некорректный FPS экспорта");
  const exportStart = number(settings.start, "начало экспорта", 0, duration), exportEnd = number(settings.end, "конец экспорта", 0, duration); if (exportStart > exportEnd) throw new Error("Конец экспорта должен быть позже начала");
  const result: AnimationProject = { schemaVersion: 1, kind: "animation", id: text(source.id, "ID проекта", 80), name: text(source.name, "название проекта", 100), fps: fps as 24 | 30 | 60, duration, objects, tracks, layers, scene: { environment: oneOf(scene.environment, ["empty", "plains", "forest", "desert", "snow", "cave", "nether", "end", "sky", "studio"], "окружение"), background: color(scene.background), transparent: boolean(scene.transparent), floor: boolean(scene.floor, true), grid: boolean(scene.grid, true), axes: boolean(scene.axes), floorSize: number(scene.floorSize, "размер площадки", 2, 100), shadows: boolean(scene.shadows, true), ambient: number(scene.ambient, "яркость окружения", 0, 10), activeCameraId: scene.activeCameraId ? text(scene.activeCameraId, "камера сцены", 80) : undefined }, export: { format: oneOf(settings.format, ["gif", "webm", "mp4", "png-sequence", "png", "minepose"], "формат экспорта"), width: number(settings.width, "ширина", 16, 8192), height: number(settings.height, "высота", 16, 8192), fps: exportFps as 24 | 30 | 60, start: exportStart, end: exportEnd, transparent: boolean(settings.transparent), quality: number(settings.quality, "качество", 0, 1), cameraId: settings.cameraId ? text(settings.cameraId, "камера экспорта", 80) : undefined, loop: boolean(settings.loop, true), audio: boolean(settings.audio) }, updatedAt: typeof source.updatedAt === "number" && Number.isFinite(source.updatedAt) ? source.updatedAt : Date.now() };
  for (const cameraId of [result.scene.activeCameraId, result.export.cameraId]) if (cameraId && !objects.some(value => value.id === cameraId && value.camera)) throw new Error("Камера проекта не найдена");
  if (!Number.isInteger(result.export.width) || !Number.isInteger(result.export.height)) throw new Error("Размер изображения должен быть целым числом");
  return result;
}
