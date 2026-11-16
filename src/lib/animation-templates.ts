import { createAnimationProject, type AnimationTemplate } from "./animation";

export type AnimationTemplateCategory = "basics" | "movement" | "scene" | "gif";
export type AnimationTemplateDefinition = {
  id: AnimationTemplate;
  name: string;
  category: AnimationTemplateCategory;
  categoryLabel: string;
  description: string;
  detail: string;
  tags: string[];
};

export const ANIMATION_TEMPLATE_CATEGORIES = [
  { id: "all", label: "Все шаблоны" },
  { id: "basics", label: "С нуля" },
  { id: "movement", label: "Движение" },
  { id: "scene", label: "Сцены" },
  { id: "gif", label: "Для GIF" },
] as const;

export const ANIMATION_TEMPLATES: AnimationTemplateDefinition[] = [
  { id: "empty", name: "Пустой проект", category: "basics", categoryLabel: "Чистый холст", description: "Твой персонаж, камера и свет. Первое движение — за тобой.", detail: "Начни с чистой сцены без готовых ключей. Поставь персонажа, выбери часть тела и создай своё первое движение на Timeline.", tags: ["Нулевые ключи", "Своя идея", "empty", "blank"] },
  { id: "walk", name: "Анимация ходьбы", category: "movement", categoryLabel: "Цикл движения", description: "Плавный шаг, встречное движение рук и лёгкий подъём корпуса.", detail: "Готовый цикл ходьбы с отдельными дорожками частей тела. Измени темп, амплитуду и позу, чтобы у персонажа появился свой характер.", tags: ["Зацикленный шаг", "Риг персонажа", "walk", "ходить"] },
  { id: "combat", name: "Боевая сцена", category: "scene", categoryLabel: "Два персонажа", description: "Атака мечом и защита щитом в одной готовой сцене.", detail: "Два персонажа с независимой анимацией: комбо-удары и блокирование. Меч и щит прикреплены к рукам и открываются вместе со сценой.", tags: ["Меч и щит", "Независимые риги", "combat", "бой", "атака"] },
  { id: "dance", name: "Танец", category: "movement", categoryLabel: "Эмоции и ритм", description: "Движение рук, повороты корпуса и ритмичные шаги.", detail: "Готовый танец с ключами на руках, ногах и корпусе. Добавь свой трек, настрой ритм или смешай движение с другим слоем анимации.", tags: ["Готовые ключи", "Слои движения", "dance", "танцевать"] },
  { id: "cinematic", name: "Кинематографическая", category: "scene", categoryLabel: "Движение камеры", description: "Плавный пролёт камеры вокруг персонажа в Minecraft-лесу.", detail: "Камера движется между ключами с плавным ускорением и замедлением. Персонаж остаётся в кадре среди деревьев Minecraft-леса.", tags: ["Анимированная камера", "Лес", "cinematic", "кино"] },
  { id: "gif", name: "Анимация для GIF", category: "gif", categoryLabel: "Квадратный кадр", description: "Приветствие для GIF с прозрачным фоном и кадром 512 × 512.", detail: "Персонаж машет рукой в квадратном кадре. Прозрачный фон и формат GIF уже выбраны в настройках экспорта — можно сразу добавить свой скин.", tags: ["Прозрачный фон", "512 × 512", "gif", "приветствие"] },
];

export function animationTemplateSummary(id: AnimationTemplate) {
  const project = createAnimationProject(id);
  return { duration: project.duration, fps: project.fps, characters: project.objects.filter(object => object.character).length, tracks: project.tracks.length, width: project.export.width, height: project.export.height, transparent: project.export.transparent, format: project.export.format, animatedCamera: project.tracks.some(track => project.objects.some(object => object.id === track.objectId && object.camera)) };
}
