import catalog from "@/data/item-catalog.json";

export type Hand = "right" | "left";
export type ItemCategory = "diamond" | "netherite" | "tools" | "blocks" | "food" | "special";
export type ItemDefinition = {
  id: string;
  name: string;
  category: ItemCategory;
  model: string;
  icon: string;
  keywords?: string[];
};
export type ItemVector = { x: number; y: number; z: number };
export type ItemTransform = { position: ItemVector; rotation: ItemVector; scale: number };
export type EquippedItem = { id: string; transform: ItemTransform };
export type EquippedItems = Record<Hand, EquippedItem | null>;
export const ITEM_CATEGORIES: { id: ItemCategory; name: string }[] = [
  { id: "diamond", name: "Алмазные" },
  { id: "netherite", name: "Незеритовые" },
  { id: "tools", name: "Оружие и инструменты" },
  { id: "blocks", name: "Блоки" },
  { id: "food", name: "Еда" },
  { id: "special", name: "Особые" },
];
export const ITEM_CATALOG = catalog as ItemDefinition[];
const byId = new Map(ITEM_CATALOG.map(item => [item.id, item]));
export function getItemDefinition(id: string) { return byId.get(id); }
export function makeEquippedItem(id: string): EquippedItem {
  return { id, transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 } };
}
export function emptyItems(): EquippedItems { return { right: null, left: null }; }

/** Old sword-only projects retain their item when opened in the new editor. */
export function migrateItems(sword = false): EquippedItems {
  return { right: sword ? makeEquippedItem("diamond_sword") : null, left: null };
}

export function parseEquippedItems(value: unknown, legacySword = false): EquippedItems {
  if (value === undefined) return migrateItems(legacySword);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректные предметы в проекте");
  const result = emptyItems();
  for (const hand of ["right", "left"] as const) {
    const source = (value as Record<string, unknown>)[hand];
    if (source === null || source === undefined) continue;
    if (typeof source !== "object" || Array.isArray(source)) throw new Error("Некорректный предмет в руке");
    const entry = source as Record<string, unknown>;
    if (typeof entry.id !== "string" || !getItemDefinition(entry.id)) throw new Error("Неизвестный предмет в проекте");
    const transform = entry.transform as Record<string, unknown> | undefined;
    if (!transform || typeof transform !== "object" || Array.isArray(transform)) throw new Error("Некорректное положение предмета");
    const parsed = makeEquippedItem(entry.id);
    for (const field of ["position", "rotation"] as const) {
      const vector = transform[field] as Record<string, unknown> | undefined;
      if (!vector || typeof vector !== "object" || Array.isArray(vector)) throw new Error("Некорректные координаты предмета");
      for (const axis of ["x", "y", "z"] as const) {
        const number = vector[axis];
        if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > (field === "position" ? 4 : 360)) throw new Error("Координаты предмета вне допустимого диапазона");
        parsed.transform[field][axis] = number;
      }
    }
    if (typeof transform.scale !== "number" || !Number.isFinite(transform.scale) || transform.scale < .25 || transform.scale > 3) throw new Error("Некорректный масштаб предмета");
    parsed.transform.scale = transform.scale;
    result[hand] = parsed;
  }
  return result;
}
