import type { AnimationProject } from "./animation";
import { parseAnimationProject } from "./animation-validation";

const DATABASE = "minepose-animation-studio-v1";
let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => { const db = request.result; for (const name of ["projects", "meta", "skins", "scenes"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
    request.onerror = () => { opening = undefined; reject(new Error("Браузер не разрешил открыть локальное хранилище анимаций")); };
    request.onblocked = () => { opening = undefined; reject(new Error("Закройте другую вкладку MinePose, чтобы обновить хранилище")); };
  });
  return opening;
}
async function read<T>(store: string, id?: string): Promise<T> { const db = await database(); return new Promise<T>((resolve, reject) => { const transaction = db.transaction(store, "readonly"), request = id === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(id); request.onsuccess = () => resolve(request.result as T); request.onerror = () => reject(new Error("Не удалось прочитать сохранённые анимации")); }); }
async function put(store: string, value: unknown): Promise<void> { const db = await database(); return new Promise((resolve, reject) => { const transaction = db.transaction(store, "readwrite"); transaction.objectStore(store).put(value); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(new Error("Недостаточно места для сохранения. Скачайте проект .minepose")); transaction.onabort = () => reject(new Error("Сохранение анимации прервано. Скачайте проект .minepose")); }); }
export async function listAnimationProjects(): Promise<AnimationProject[]> { return (await read<unknown[]>("projects")).map(parseAnimationProject).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function loadAnimationProject(id: string): Promise<AnimationProject | null> { const value = await read<unknown>("projects", id); return value ? parseAnimationProject(value) : null; }
export async function saveAnimationProject(project: AnimationProject): Promise<void> { await put("projects", parseAnimationProject(project)); }
export async function deleteAnimationProjects(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const selected = new Set(ids), db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["projects", "meta"], "readwrite");
    for (const id of selected) tx.objectStore("projects").delete(id);
    const request = tx.objectStore("meta").get("draft");
    request.onsuccess = () => { if (selected.has(request.result?.project?.id)) tx.objectStore("meta").delete("draft"); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("Не удалось удалить анимации"));
    tx.onabort = () => reject(new Error("Удаление анимаций прервано"));
  });
}
export async function deleteAnimationProject(id: string): Promise<void> { return deleteAnimationProjects([id]); }
export async function saveAnimationDraft(project: AnimationProject): Promise<void> { const valid = parseAnimationProject(project); const db = await database(); await new Promise<void>((resolve, reject) => { const tx = db.transaction(["projects", "meta"], "readwrite"); tx.objectStore("projects").put(valid); tx.objectStore("meta").put({ id: "draft", project: valid }); tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error("Не удалось сохранить черновик. Скачайте .minepose")); tx.onabort = () => reject(new Error("Черновик не сохранён. Скачайте .minepose")); }); }
export async function loadAnimationDraft(): Promise<AnimationProject | null> { const value = await read<{ project: unknown } | undefined>("meta", "draft"); return value?.project ? parseAnimationProject(value.project) : null; }
export type StudioSkin = { id: string; name: string; skin: string; slim: boolean; updatedAt: number };
export async function saveStudioSkin(value: { id?: string; name: string; skin: string; slim: boolean }): Promise<StudioSkin> { const existing = await loadStudioSkins(); const saved = { ...value, id: value.id || existing.find(item => item.skin === value.skin && item.slim === value.slim)?.id || crypto.randomUUID(), updatedAt: Date.now() }; await put("skins", saved); return saved; }
export async function loadStudioSkins(): Promise<StudioSkin[]> { return (await read<StudioSkin[]>("skins")).sort((a, b) => b.updatedAt - a.updatedAt); }
export async function saveSceneTemplate(name: string, project: AnimationProject): Promise<void> { await put("scenes", { id: crypto.randomUUID(), name, scene: project.scene, objects: project.objects.filter(value => value.type !== "character" && value.type !== "audio"), updatedAt: Date.now() }); }
export async function loadSceneTemplates(): Promise<{ id: string; name: string; scene: AnimationProject["scene"]; objects: AnimationProject["objects"] }[]> { return read("scenes"); }
