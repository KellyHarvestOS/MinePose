import { GIFEncoder, quantize, applyPalette } from "gifenc";
import { Zip, ZipPassThrough, strToU8 } from "fflate";

type Request = { id: number; action: "init" | "gif-frame" | "png-frame" | "finish"; format?: "gif" | "png-sequence"; width?: number; height?: number; fps?: number; quality?: number; transparent?: boolean; loop?: boolean; pixels?: ArrayBuffer; bytes?: ArrayBuffer; delay?: number; name?: string; manifest?: string };
type Response = { id: number; kind: "ok" | "error" | "result"; message?: string; buffer?: ArrayBuffer; mime?: string };
const scope = globalThis as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage: (value: Response, transfer?: Transferable[]) => void };
let gif: ReturnType<typeof GIFEncoder> | undefined;
let zip: Zip | undefined;
let width = 0, height = 0, transparent = false, loop = true, quality = .75, format: "gif" | "png-sequence" = "gif";
let chunks: Uint8Array[] = [];
let totalBytes = 0;
let finishId = 0;
const MAX_BYTES = 512 * 1024 * 1024;

function result(bytes: Uint8Array, mime: string, id: number) {
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer as ArrayBuffer : bytes.slice().buffer as ArrayBuffer;
  scope.postMessage({ id, kind: "result", buffer, mime }, [buffer]);
}

function pngFile(name: string, bytes: Uint8Array) {
  if (!zip) throw new Error("Архив не подготовлен");
  const entry = new ZipPassThrough(name);
  entry.mtime = new Date("2000-01-01T00:00:00Z");
  zip.add(entry); entry.push(bytes, true);
}

scope.onmessage = ({ data }) => {
  try {
    if (data.action === "init") {
      width = data.width || 0; height = data.height || 0;
      transparent = Boolean(data.transparent); loop = data.loop !== false; quality = data.quality ?? .75;
      format = data.format || "gif"; chunks = []; totalBytes = 0; finishId = 0;
      if (format === "gif") gif = GIFEncoder();
      else {
        zip = new Zip((error, bytes, final) => {
          if (error) { scope.postMessage({ id: finishId || 0, kind: "error", message: error.message }); return; }
          totalBytes += bytes.byteLength;
          if (totalBytes > MAX_BYTES) { zip?.terminate(); scope.postMessage({ id: finishId || 0, kind: "error", message: "Архив превысил 512 МБ. Уменьшите разрешение или диапазон кадров." }); return; }
          chunks.push(bytes);
          if (final) {
            const output = new Uint8Array(totalBytes); let offset = 0;
            for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
            chunks = []; result(output, "application/zip", finishId);
          }
        });
        if (data.manifest) pngFile("manifest.json", strToU8(data.manifest));
      }
      scope.postMessage({ id: data.id, kind: "ok" });
      return;
    }
    if (data.action === "gif-frame") {
      if (!gif || !data.pixels) throw new Error("Нет пикселей кадра");
      const pixels = new Uint8Array(data.pixels);
      if (transparent) for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 128) pixels[index] = pixels[index + 1] = pixels[index + 2] = pixels[index + 3] = 0;
        else pixels[index + 3] = 255;
      }
      const pixelFormat = transparent ? "rgba4444" : quality < .4 ? "rgb444" : "rgb565";
      const palette = quantize(pixels, transparent ? 255 : quality < .4 ? 128 : 256, { format: pixelFormat, oneBitAlpha: true, clearAlpha: true });
      if (transparent) {
        const alphaIndex = palette.findIndex(color => color.length > 3 && color[3] < 128);
        if (alphaIndex >= 0) { const [clear] = palette.splice(alphaIndex, 1); palette.unshift(clear); }
        else palette.unshift([0, 0, 0, 0]);
      }
      const indexed = applyPalette(pixels, palette, pixelFormat);
      gif.writeFrame(indexed, width, height, { palette, delay: data.delay || 10, transparent, transparentIndex: 0, repeat: loop ? 0 : -1, dispose: transparent ? 2 : 1 });
      if (gif.bytesView().byteLength > MAX_BYTES) throw new Error("GIF превысил 512 МБ. Уменьшите разрешение или диапазон кадров.");
      scope.postMessage({ id: data.id, kind: "ok" });
      return;
    }
    if (data.action === "png-frame") {
      if (!data.bytes || !data.name) throw new Error("Нет PNG-кадра");
      pngFile(data.name, new Uint8Array(data.bytes));
      scope.postMessage({ id: data.id, kind: "ok" });
      return;
    }
    finishId = data.id;
    if (format === "gif") {
      if (!gif) throw new Error("GIF не подготовлен");
      gif.finish(); result(gif.bytes(), "image/gif", data.id); gif = undefined;
    } else {
      if (!zip) throw new Error("Архив не подготовлен");
      zip.end();
    }
  } catch (error) { scope.postMessage({ id: data.id, kind: "error", message: error instanceof Error ? error.message : "Ошибка кодирования кадров" }); }
};
