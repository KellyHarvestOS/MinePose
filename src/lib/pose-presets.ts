import type { Pose, Rotation, SceneSettings } from "./types";
import { emptyItems, makeEquippedItem, type EquippedItems, type EquippedItem, type ItemTransform } from "./items";

export type PosePreset = {
  id: string;
  name: string;
  description: string;
  color: string;
  tag: string;
  category: string;
  pose: Pose;
  position: Rotation;
  rotation: Rotation;
  items: EquippedItems;
  camera?: { azimuth: number; elevation: number };
  sword?: boolean;
};

const vector = (x = 0, y = 0, z = 0): Rotation => ({ x, y, z });
const equipment = (id: string, transform: Partial<ItemTransform> = {}): EquippedItem => {
  const item = makeEquippedItem(id);
  item.transform = { ...item.transform, ...transform };
  return item;
};

export const PRESETS: PosePreset[] = [
  {
    id: "adventure", name: "Искатель приключений", category: "Приключения", tag: "ПРИКЛЮЧЕНИЯ",
    description: "Уверенный шаг навстречу новому миру", color: "#a58bc7", sword: true,
    pose: {
      head: vector(-4, -12, -2), body: vector(4, 12, 0),
      rightArm: vector(-32, -8, -12), leftArm: vector(28, 4, 14),
      rightLeg: vector(-32, 2, -7), leftLeg: vector(28, -2, 6),
    },
    position: vector(.02, -.004, -.02), rotation: vector(), camera: { azimuth: 30, elevation: 12 },
    items: { right: equipment("diamond_sword", { rotation: vector(0, 5, -15) }), left: null },
  },
  {
    id: "hello", name: "Приветствие", category: "Эмоции", tag: "ЭМОЦИИ",
    description: "Привет своему миру и новым друзьям", color: "#a293c4",
    pose: {
      head: vector(0, 8, -7), body: vector(0, -6, 0),
      rightArm: vector(-12, -8, -145), leftArm: vector(8, 0, 7),
      rightLeg: vector(0, -3, -4), leftLeg: vector(3, 3, 4),
    },
    position: vector(0, .06, 0), rotation: vector(), camera: { azimuth: 25, elevation: 11 }, items: emptyItems(),
  },
  {
    id: "battle", name: "Боевая стойка", category: "Экшен", tag: "ЭКШЕН",
    description: "Алмазный клинок и готовность к бою", color: "#829fb6", sword: true,
    pose: {
      head: vector(-7, 20, 0), body: vector(12, -20, 0),
      rightArm: vector(-86, -20, -26), leftArm: vector(-70, 12, -22),
      rightLeg: vector(-26, -12, -22), leftLeg: vector(24, 12, 24),
    },
    position: vector(-.02, .014, .06), rotation: vector(), camera: { azimuth: 32, elevation: 12 },
    items: { right: equipment("diamond_sword", { rotation: vector(0, -8, 12) }), left: null },
  },
  {
    id: "chill", name: "Расслабленная поза", category: "Настроение", tag: "НАСТРОЕНИЕ",
    description: "Небольшая пауза между приключениями", color: "#b09a85",
    pose: {
      head: vector(-8, 14, 9), body: vector(-3, -8, -5),
      rightArm: vector(10, 5, -13), leftArm: vector(2, -8, 14),
      rightLeg: vector(-16, -5, -13), leftLeg: vector(2, 3, 3),
    },
    position: vector(.1, .07, .02), rotation: vector(), camera: { azimuth: 28, elevation: 12 }, items: emptyItems(),
  },
  {
    id: "miner", name: "Шахтёр", category: "Работа", tag: "РАБОТА",
    description: "Замах киркой перед следующим ударом", color: "#9792a7",
    pose: {
      head: vector(18, -5, 0), body: vector(8, 20, -2),
      rightArm: vector(-105, 0, -15), leftArm: vector(-82, 0, -62),
      rightLeg: vector(-12, -8, -13), leftLeg: vector(18, 8, 14),
    },
    position: vector(0, .078, -.03), rotation: vector(), camera: { azimuth: 35, elevation: 12 },
    items: {
      right: equipment("diamond_pickaxe", { position: vector(.242, .37, -.285), rotation: vector(61.958, -30.328, -17.035), scale: 1.35 }),
      left: null,
    },
  },
  {
    id: "builder", name: "Строитель", category: "Творчество", tag: "ТВОРЧЕСТВО",
    description: "Ещё один блок для большой идеи", color: "#929c87",
    pose: {
      head: vector(14, -14, 0), body: vector(6, -18, 2),
      rightArm: vector(-92, -5, -12), leftArm: vector(-28, 7, 24),
      rightLeg: vector(-8, -6, -6), leftLeg: vector(9, 6, 8),
    },
    position: vector(.02, .078, 0), rotation: vector(), camera: { azimuth: 38, elevation: 13 },
    items: {
      right: equipment("grass_block", { position: vector(-.088, -.26, .261), rotation: vector(-79.408, 34.445, 174.786), scale: 1.25 }),
      left: null,
    },
  },
  {
    id: "archer", name: "Лучник", category: "Экшен", tag: "ЭКШЕН",
    description: "Точный прицел перед решающим выстрелом", color: "#9e9385",
    pose: {
      head: vector(-5, 85, -2), body: vector(1, -34, 0),
      rightArm: vector(-18, -8, 80), leftArm: vector(0, 0, 90),
      rightLeg: vector(-10, -5, -14), leftLeg: vector(12, 8, 15),
    },
    position: vector(-.03, .077, .04), rotation: vector(), camera: { azimuth: 12, elevation: 10 },
    items: {
      right: null,
      left: equipment("bow", { position: vector(.285, .17, .129), rotation: vector(-80.192, 4.666, 91.786) }),
    },
  },
  {
    id: "defender", name: "Защитник", category: "Битва", tag: "БИТВА",
    description: "Щит впереди, незеритовый меч наготове", color: "#91899e",
    pose: {
      head: vector(1, 9, -2), body: vector(-8, -10, -2),
      rightArm: vector(-42, -15, -22), leftArm: vector(-68, -10, -12),
      rightLeg: vector(-20, -10, -16), leftLeg: vector(15, 9, 18),
    },
    position: vector(.04, .055, -.04), rotation: vector(), camera: { azimuth: 30, elevation: 12 },
    items: {
      right: equipment("netherite_sword", { rotation: vector(5, 0, -18) }),
      left: equipment("shield", { position: vector(-.1, 0, .04), rotation: vector(65, 10, 8), scale: .94 }),
    },
  },
  {
    id: "winner", name: "Победитель", category: "Эмоции", tag: "ЭМОЦИИ",
    description: "Руки вверх — этот день точно твой", color: "#b09cbb",
    pose: {
      head: vector(-24, 0, -5), body: vector(-10, 4, 0),
      rightArm: vector(-15, -8, -148), leftArm: vector(-18, 8, 150),
      rightLeg: vector(-3, -5, -15), leftLeg: vector(5, 5, 16),
    },
    position: vector(0, .064, .01), rotation: vector(), camera: { azimuth: 28, elevation: 11 }, items: emptyItems(),
  },
  {
    id: "run", name: "Бег", category: "Движение", tag: "ДВИЖЕНИЕ",
    description: "Полный ход навстречу новой истории", color: "#9c8eba",
    pose: {
      head: vector(-9, -8, 2), body: vector(17, 9, -4),
      rightArm: vector(52, 2, -22), leftArm: vector(-63, -5, 28),
      rightLeg: vector(-62, -4, -10), leftLeg: vector(52, 4, 12),
    },
    position: vector(0, -.349, -.08), rotation: vector(8, 0, 0), camera: { azimuth: 35, elevation: 12 }, items: emptyItems(),
  },
  {
    id: "jump", name: "Прыжок", category: "Движение", tag: "ДВИЖЕНИЕ",
    description: "Поймай мгновение между землёй и небом", color: "#9a93bd",
    pose: {
      head: vector(-8, -14, -5), body: vector(8, 15, -9),
      rightArm: vector(-105, -12, -65), leftArm: vector(-142, 8, 43),
      rightLeg: vector(-68, -6, -16), leftLeg: vector(28, 12, 28),
    },
    position: vector(-.02, .82, 0), rotation: vector(6, -8, -5), camera: { azimuth: 30, elevation: 12 }, items: emptyItems(),
  },
  {
    id: "sneak", name: "Скрытность", category: "Приключения", tag: "ПРИКЛЮЧЕНИЯ",
    description: "Тише шаг — ближе к своей цели", color: "#8e879e",
    pose: {
      head: vector(10, -8, 0), body: vector(42, 8, -4),
      rightArm: vector(-88, 3, 20), leftArm: vector(-82, -4, -22),
      rightLeg: vector(-58, 0, -8), leftLeg: vector(-42, 6, 10),
    },
    position: vector(0, -.162, .06), rotation: vector(), camera: { azimuth: 34, elevation: 12 }, items: emptyItems(),
  },
];

export function presetScene(preset: PosePreset, skin = "", slim = false): SceneSettings {
  return {
    background: "#21192d", floor: true, grid: false, light: 1.3, skin, slim, sword: false,
    items: structuredClone(preset.items), modelPosition: { ...preset.position }, modelRotation: { ...preset.rotation },
    previewCamera: preset.camera ? { ...preset.camera } : undefined,
  };
}
