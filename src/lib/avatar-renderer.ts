import type { AvatarSettings } from "./avatars";

/** Photo measurements are expressed on a 1024px square, independent of export size. */
export function avatarFrame(settings: AvatarSettings) {
  return settings.frame && settings.background !== "transparent" ? settings.frameWidth : 0;
}

/** Uses the same inner square, vertical gradient, corners and zoom as the live photo. */
export async function composeAvatar(settings: AvatarSettings, renderUrl: string): Promise<HTMLCanvasElement> {
  const size = settings.resolution;
  const scale = size / 1024;
  const inset = avatarFrame(settings) * scale;
  const innerSize = size - inset * 2;
  const radius = settings.round ? 40 * scale : 0;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось создать изображение аватарки");
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось подготовить аватарку к сохранению"));
    img.src = renderUrl;
  });
  context.save();
  context.beginPath();
  context.roundRect(0, 0, size, size, radius);
  context.clip();
  if (inset > 0) {
    context.fillStyle = settings.frameColor;
    context.fillRect(0, 0, size, size);
  }
  context.beginPath();
  context.roundRect(inset, inset, innerSize, innerSize, Math.max(0, radius - inset));
  context.clip();
  if (settings.background === "gradient") {
    const gradient = context.createLinearGradient(0, inset, 0, size - inset);
    gradient.addColorStop(0, settings.color);
    gradient.addColorStop(1, settings.endColor);
    context.fillStyle = gradient;
    context.fillRect(inset, inset, innerSize, innerSize);
  } else if (settings.background === "solid") {
    context.fillStyle = settings.color;
    context.fillRect(inset, inset, innerSize, innerSize);
  }
  const drawingSize = innerSize * settings.zoom / 100;
  const offset = (size - drawingSize) / 2;
  context.drawImage(image, offset, offset, drawingSize, drawingSize);
  context.restore();
  return canvas;
}
