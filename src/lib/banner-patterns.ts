import type { BannerDesign, BannerPattern } from "./banners";

const pattern = (id: string, label: string, category: BannerPattern["category"]): BannerPattern => ({ id, label, category, texture: `/textures/banner/${id}.png` });

/** Vanilla Java 1.21 banner registry, excluding the unpatterned base. */
export const BANNER_PATTERNS: BannerPattern[] = [
  pattern("stripe_bottom", "Полоса снизу", "stripes"),
  pattern("stripe_top", "Полоса сверху", "stripes"),
  pattern("stripe_left", "Полоса слева", "stripes"),
  pattern("stripe_right", "Полоса справа", "stripes"),
  pattern("stripe_center", "Вертикальная полоса", "stripes"),
  pattern("stripe_middle", "Горизонтальная полоса", "stripes"),
  pattern("stripe_downright", "Диагональ вправо", "stripes"),
  pattern("stripe_downleft", "Диагональ влево", "stripes"),
  pattern("small_stripes", "Мелкие полосы", "stripes"),
  pattern("straight_cross", "Прямой крест", "shapes"),
  pattern("cross", "Косой крест", "shapes"),
  pattern("border", "Кайма", "shapes"),
  pattern("curly_border", "Зубчатая кайма", "shapes"),
  pattern("circle", "Круг", "shapes"),
  pattern("rhombus", "Ромб", "shapes"),
  pattern("half_vertical", "Левая половина", "shapes"),
  pattern("half_vertical_right", "Правая половина", "shapes"),
  pattern("half_horizontal", "Верхняя половина", "shapes"),
  pattern("half_horizontal_bottom", "Нижняя половина", "shapes"),
  pattern("triangle_top", "Треугольник сверху", "shapes"),
  pattern("triangle_bottom", "Треугольник снизу", "shapes"),
  pattern("triangles_top", "Зубцы сверху", "shapes"),
  pattern("triangles_bottom", "Зубцы снизу", "shapes"),
  pattern("bricks", "Кирпичи", "shapes"),
  pattern("gradient", "Градиент вниз", "shapes"),
  pattern("gradient_up", "Градиент вверх", "shapes"),
  pattern("square_top_left", "Верхний левый угол", "shapes"),
  pattern("square_top_right", "Верхний правый угол", "shapes"),
  pattern("square_bottom_left", "Нижний левый угол", "shapes"),
  pattern("square_bottom_right", "Нижний правый угол", "shapes"),
  pattern("diagonal_left", "Скос слева", "shapes"),
  pattern("diagonal_right", "Скос справа", "shapes"),
  pattern("diagonal_up_left", "Обратный скос слева", "shapes"),
  pattern("diagonal_up_right", "Обратный скос справа", "shapes"),
  pattern("creeper", "Крипер", "icons"),
  pattern("flower", "Цветок", "icons"),
  pattern("skull", "Череп", "icons"),
  pattern("globe", "Глобус", "icons"),
  pattern("mojang", "Моджанг", "icons"),
  pattern("piglin", "Пятачок", "icons"),
  pattern("flow", "Поток", "icons"),
  pattern("guster", "Вихрь", "icons"),
];

export const DEFAULT_BANNER: BannerDesign = {
  base: "purple",
  layers: [
    { id: "brand-gradient", pattern: "gradient", color: "magenta" },
    { id: "brand-flower", pattern: "flower", color: "white" },
    { id: "brand-border", pattern: "border", color: "black" },
  ],
};

export const BANNER_PRESETS: { id: string; label: string; design: BannerDesign }[] = [
  { id: "creeper", label: "Крипер", design: { base: "lime", layers: [
    { id: "creeper-gradient", pattern: "gradient", color: "green" },
    { id: "creeper-icon", pattern: "creeper", color: "black" },
    { id: "creeper-border", pattern: "border", color: "green" },
  ] } },
  { id: "flower", label: "Цветок", design: { base: "purple", layers: [
    { id: "flower-gradient", pattern: "gradient_up", color: "magenta" },
    { id: "flower-icon", pattern: "flower", color: "yellow" },
    { id: "flower-border", pattern: "curly_border", color: "black" },
  ] } },
  { id: "globe", label: "Глобус", design: { base: "blue", layers: [
    { id: "globe-gradient", pattern: "gradient", color: "cyan" },
    { id: "globe-icon", pattern: "globe", color: "white" },
    { id: "globe-border", pattern: "border", color: "light_blue" },
  ] } },
  { id: "pirate", label: "Пиратский", design: { base: "black", layers: [
    { id: "pirate-stripes", pattern: "small_stripes", color: "gray" },
    { id: "pirate-icon", pattern: "skull", color: "white" },
    { id: "pirate-border", pattern: "border", color: "red" },
  ] } },
];
