import { HEADING_FONTS, type HeadingOptions } from "./headings";

const WIDTH = 1600;
const HEIGHT = 480;
const DESIGN_WIDTH = 400;
const DESIGN_HEIGHT = 120;
const OUTPUT_SCALE = WIDTH / DESIGN_WIDTH;
const PADDING = 14;

type Glyph = { character: string; x: number };
type Line = { glyphs: Glyph[]; width: number; left: number; ascent: number; descent: number };
type Layout = { lines: Line[]; ascent: number; descent: number; gap: number; height: number; fontSize: number };

const clamp = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const hex = (value: string, fallback: string) => /^#[\da-f]{6}$/i.test(value) ? value : fallback;

function darker(color: string) {
  return `#${color.slice(1).match(/../g)!.map(channel => Math.round(parseInt(channel, 16) * .29).toString(16).padStart(2, "0")).join("")}`;
}

function measureLine(context: CanvasRenderingContext2D, text: string, spacing: number): Line {
  const glyphs: Glyph[] = [];
  let cursor = 0, left = 0, right = 0, ascent = 0, descent = 0;
  const characters = Array.from(text);
  characters.forEach((character, index) => {
    const metrics = context.measureText(character);
    glyphs.push({ character, x: cursor });
    left = Math.min(left, cursor - metrics.actualBoundingBoxLeft);
    right = Math.max(right, cursor + metrics.actualBoundingBoxRight);
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent);
    descent = Math.max(descent, metrics.actualBoundingBoxDescent);
    cursor += metrics.width + (index === characters.length - 1 ? 0 : spacing);
  });
  return { glyphs, width: Math.max(right, cursor) - left, left, ascent, descent };
}

/** Paints the same 1600 × 480 image for the editor, clipboard and PNG export. */
export async function renderHeading(canvas: HTMLCanvasElement, options: HeadingOptions): Promise<void> {
  if (typeof document === "undefined") throw new Error("Генератор изображений доступен в браузере");
  const font = HEADING_FONTS.find(item => item.id === options.font);
  if (!font) throw new Error("Выберите шрифт заголовка");

  const textLines = options.text.replace(/\r/g, "").split("\n").slice(0, 2).map(line => line.trim());
  const hasText = textLines.some(line => line.length > 0);
  const color = hex(options.color, "#ffffff");
  const outlineColor = hex(options.outlineColor, "#24202d");
  const background = hex(options.background, "#1a1522");
  const outline = clamp(options.outlineWidth, 0, 6, 1);
  const depth = Math.round(clamp(options.depth, 0, 12, 3));

  if (hasText) {
    // A successful check alone can also describe a browser fallback. Require
    // an actual loaded FontFace so an export can never silently use Arial.
    const query = `${font.weight} 32px ${JSON.stringify(font.family)}`;
    const sample = textLines.join(" ");
    let faces: FontFace[];
    try {
      faces = await document.fonts.load(query, sample);
      await document.fonts.ready;
    } catch {
      throw new Error(`Не удалось загрузить шрифт «${font.label}». Попробуйте ещё раз`);
    }
    if (!faces.length || faces.some(face => face.status !== "loaded") || !document.fonts.check(query, sample)) {
      throw new Error(`Шрифт «${font.label}» ещё не загружен. Попробуйте ещё раз`);
    }
  }

  const work = document.createElement("canvas");
  work.width = font.pixel ? DESIGN_WIDTH : WIDTH;
  work.height = font.pixel ? DESIGN_HEIGHT : HEIGHT;
  const context = work.getContext("2d");
  const output = canvas.getContext("2d");
  if (!context || !output) throw new Error("Не удалось создать изображение заголовка");
  if (!font.pixel) context.scale(OUTPUT_SCALE, OUTPUT_SCALE);
  context.imageSmoothingEnabled = false;
  if (!options.transparent) {
    context.fillStyle = background;
    context.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
  }

  if (hasText) {
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.fontKerning = "none";
    context.lineJoin = font.pixel ? "miter" : "round";
    context.miterLimit = 2;

    const requestedSize = (textLines.length > 1 ? 31 : 44) * clamp(options.size, 50, 150, 100) / 100;
    const requestedSpacing = clamp(options.letterSpacing, 0, 6, 0);
    const round = (value: number) => font.pixel ? Math.round(value) : value;
    const measure = (factor: number): Layout => {
      const fontSize = font.pixel ? Math.max(1, Math.floor(requestedSize * factor)) : Math.max(1, requestedSize * factor);
      const spacing = round(requestedSpacing * factor);
      context.font = `${font.weight} ${fontSize}px ${JSON.stringify(font.family)}`;
      const lines = textLines.map(line => measureLine(context, line, spacing));
      const ascent = Math.max(...lines.map(line => line.ascent));
      const descent = Math.max(...lines.map(line => line.descent));
      const gap = round(fontSize * .28);
      const height = (ascent + descent) * lines.length + gap * (lines.length - 1);
      return { lines, ascent, descent, gap, height, fontSize };
    };
    const fits = (layout: Layout) => layout.height + outline * 2 + depth <= DESIGN_HEIGHT - PADDING * 2
      && layout.lines.every(line => line.width + outline * 2 + depth <= DESIGN_WIDTH - PADDING * 2);

    let layout = measure(1);
    if (!fits(layout)) {
      let low = 0, high = 1;
      for (let step = 0; step < 22; step++) {
        const middle = (low + high) / 2;
        if (fits(measure(middle))) low = middle;
        else high = middle;
      }
      layout = measure(low);
    }
    // The binary search changes context.font, so restore the chosen size before
    // painting rather than depending on which candidate was measured last.
    context.font = `${font.weight} ${layout.fontSize}px ${JSON.stringify(font.family)}`;
    const top = round((DESIGN_HEIGHT - layout.height - depth) / 2);
    const positions = layout.lines.map((line, index) => ({
      line,
      x: round((DESIGN_WIDTH - line.width - depth) / 2 - line.left),
      y: round(top + layout.ascent + index * (layout.ascent + layout.descent + layout.gap)),
    }));
    const stroke = (offset: number) => {
      if (!outline) return;
      for (const { line, x, y } of positions) for (const glyph of line.glyphs) context.strokeText(glyph.character, round(x + glyph.x + offset), y + offset);
    };
    const fill = (offset: number) => {
      for (const { line, x, y } of positions) for (const glyph of line.glyphs) context.fillText(glyph.character, round(x + glyph.x + offset), y + offset);
    };

    context.lineWidth = outline * 2;
    context.strokeStyle = outlineColor;
    context.fillStyle = darker(color);
    for (let offset = depth; offset > 0; offset--) {
      stroke(offset);
      fill(offset);
    }
    stroke(0);
    if (options.gradient) {
      const gradient = context.createLinearGradient(0, top, 0, Math.max(top + 1, top + layout.height));
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, hex(options.endColor, "#a56bea"));
      context.fillStyle = gradient;
    } else context.fillStyle = color;
    fill(0);
  }

  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  output.imageSmoothingEnabled = !font.pixel;
  output.drawImage(work, 0, 0, WIDTH, HEIGHT);
}
