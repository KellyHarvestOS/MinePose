import { DYES, MAX_BANNER_LAYERS, type BannerDesign, type BannerLayer, type DyeId } from "./banners";
import { BANNER_PATTERNS } from "./banner-patterns";

const dyes = new Map(DYES.map(dye => [dye.id, dye]));
const patterns = new Map(BANNER_PATTERNS.map(pattern => [pattern.id, pattern]));
const images = new Map<string, Promise<HTMLImageElement>>();
const coloredTextures = new Map<string, Promise<HTMLCanvasElement>>();
const FACE_WIDTH = 20;
const FACE_HEIGHT = 40;

function dyeId(value: unknown): value is DyeId { return typeof value === "string" && dyes.has(value as DyeId); }

/** Imports only vanilla dyes and patterns that can be recreated in a loom. */
export function parseBannerDesign(value: unknown): BannerDesign {
  if (!value || typeof value !== "object") throw new Error("Файл не содержит дизайн флага");
  const raw = value as Record<string, unknown>;
  if (!dyeId(raw.base)) throw new Error("Выберите один из 16 красителей для основы флага");
  if (!Array.isArray(raw.layers) || raw.layers.length > MAX_BANNER_LAYERS) throw new Error(`У флага может быть не больше ${MAX_BANNER_LAYERS} слоёв`);
  const usedIds = new Set<string>();
  const layers = raw.layers.map((entry: unknown, index: number): BannerLayer => {
    if (!entry || typeof entry !== "object") throw new Error(`Некорректный слой ${index + 1}`);
    const layer = entry as Record<string, unknown>;
    const pattern = typeof layer.pattern === "string" ? layer.pattern.replace(/^minecraft:/, "") : "";
    if (!patterns.has(pattern)) throw new Error(`Неизвестный узор в слое ${index + 1}`);
    if (!dyeId(layer.color)) throw new Error(`Некорректный краситель в слое ${index + 1}`);
    const suppliedId = typeof layer.id === "string" && layer.id.length > 0 && layer.id.length <= 128 ? layer.id : "";
    const id = suppliedId && !usedIds.has(suppliedId) ? suppliedId : crypto.randomUUID();
    usedIds.add(id);
    return { id, pattern, color: layer.color };
  });
  return { base: raw.base, layers };
}

function loadTexture(path: string): Promise<HTMLImageElement> {
  let pending = images.get(path);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (image.naturalWidth < 21 || image.naturalHeight < 41) {
          images.delete(path); reject(new Error("Повреждена текстура узора флага")); return;
        }
        resolve(image);
      };
      image.onerror = () => { images.delete(path); reject(new Error("Не удалось загрузить текстуру флага. Обновите страницу.")); };
      image.src = path;
    });
    images.set(path, pending);
  }
  return pending;
}

function tintedTexture(path: string, color: DyeId): Promise<HTMLCanvasElement> {
  const key = `${path}:${color}`;
  let pending = coloredTextures.get(key);
  if (!pending) {
    pending = loadTexture(path).then(image => {
      const canvas = document.createElement("canvas"); canvas.width = FACE_WIDTH; canvas.height = FACE_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Браузер не поддерживает создание изображений");
      context.imageSmoothingEnabled = false;
      // Vanilla BannerModel's front face occupies UV [1,1]–[21,41].
      context.drawImage(image, 1, 1, FACE_WIDTH, FACE_HEIGHT, 0, 0, FACE_WIDTH, FACE_HEIGHT);
      const pixels = context.getImageData(0, 0, FACE_WIDTH, FACE_HEIGHT);
      const rgb = dyes.get(color)!.hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16));
      // Minecraft multiplies the grayscale cloth texture by the selected dye.
      // Tinting individual channels preserves its fabric shading and mask alpha.
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i] = Math.round(pixels.data[i] * rgb[0] / 255);
        pixels.data[i + 1] = Math.round(pixels.data[i + 1] * rgb[1] / 255);
        pixels.data[i + 2] = Math.round(pixels.data[i + 2] * rgb[2] / 255);
      }
      context.putImageData(pixels, 0, 0);
      return canvas;
    }).catch(error => { coloredTextures.delete(key); throw error; });
    coloredTextures.set(key, pending);
  }
  return pending;
}

/** Paints an exact 1:2 banner using vanilla textures; the array draws bottom to top. */
export async function renderBanner(canvas: HTMLCanvasElement, value: BannerDesign, width = 400): Promise<void> {
  if (typeof document === "undefined") throw new Error("Редактор флагов доступен в браузере");
  const design = parseBannerDesign(value);
  const base = tintedTexture("/textures/banner/base.png", design.base);
  const layers = design.layers.map(layer => tintedTexture(patterns.get(layer.pattern)!.texture, layer.color));
  const textures = await Promise.all([base, ...layers]);
  const face = document.createElement("canvas"); face.width = FACE_WIDTH; face.height = FACE_HEIGHT;
  const context = face.getContext("2d");
  const output = canvas.getContext("2d");
  if (!context || !output) throw new Error("Не удалось создать изображение флага");
  context.imageSmoothingEnabled = false;
  for (const texture of textures) context.drawImage(texture, 0, 0);
  const safeWidth = Number.isFinite(width) ? Math.min(2048, Math.max(20, Math.round(width))) : 400;
  canvas.width = safeWidth; canvas.height = safeWidth * 2;
  output.imageSmoothingEnabled = false;
  output.drawImage(face, 0, 0, canvas.width, canvas.height);
}

/** Modern item components, supported in Java 1.21+ including Flow and Guster. */
export function bannerCommand(value: BannerDesign): string {
  const design = parseBannerDesign(value);
  const item = `minecraft:${design.base}_banner`;
  if (!design.layers.length) return `/give @p ${item} 1`;
  const layers = design.layers.map(layer => `{pattern:"minecraft:${layer.pattern}",color:"${layer.color}"}`).join(",");
  return `/give @p ${item}[minecraft:banner_patterns=[${layers}]] 1`;
}
