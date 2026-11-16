import type { AnimationProject, ExportFormat } from "./animation";

export type AnimationExportCapability = { supported: boolean; reason?: string };
export type AnimationExportOptions = {
  project: AnimationProject;
  renderFrame: (time: number, width: number, height: number, transparent: boolean) => Promise<HTMLCanvasElement>;
  signal: AbortSignal;
  onProgress: (progress: number) => void;
  renderAudio?: (start: number, end: number) => Promise<AudioBuffer | null>;
};
type WorkerResponse = { id: number; kind: "ok" | "error" | "result"; message?: string; buffer?: ArrayBuffer; mime?: string };
type WorkerRequest = { action: "init" | "gif-frame" | "png-frame" | "finish"; [key: string]: unknown };

export function animationFormatSupportsTransparency(format: ExportFormat) { return format === "gif" || format === "png" || format === "png-sequence"; }
export function animationFormatSupportsAudio(format: ExportFormat) { return format === "webm" || format === "mp4"; }
const safeName = (name: string) => name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "minepose-animation";
const abortError = () => new DOMException("Экспорт отменён", "AbortError");
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw abortError(); }
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  checkAbort(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    task.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

function range(project: AnimationProject) {
  const settings = project.export;
  const start = Math.max(0, settings.start), end = Math.min(project.duration, settings.end);
  if (![project.duration, start, end, settings.width, settings.height, settings.fps, settings.quality].every(Number.isFinite)) throw new Error("Проверьте числовые настройки экспорта");
  if (start >= end && settings.format !== "png" && settings.format !== "minepose") throw new Error("Конец экспорта должен быть позже начала");
  if (![24, 30, 60].includes(settings.fps)) throw new Error("Выберите частоту 24, 30 или 60 кадров в секунду");
  if (!Number.isInteger(settings.width) || !Number.isInteger(settings.height) || settings.width < 16 || settings.height < 16 || settings.width > 8192 || settings.height > 8192) throw new Error("Размер кадра должен быть целым числом от 16 до 8192 пикселей");
  if (start > project.duration || end < 0 || project.duration <= 0) throw new Error("Диапазон экспорта выходит за длительность проекта");
  return { start: Math.min(start, project.duration), end, fps: settings.fps };
}

export function getAnimationExportFrameTimes(project: AnimationProject) {
  const { start, end, fps } = range(project);
  if (project.export.format === "png") return [start];
  const count = Math.max(1, Math.ceil((end - start) * fps - 1e-8));
  return Array.from({ length: count }, (_, index) => start + index / fps);
}

export async function getAnimationExportCapabilities(): Promise<Record<ExportFormat, AnimationExportCapability>> {
  const worker = typeof Worker !== "undefined";
  const browser = typeof document !== "undefined";
  const result: Record<ExportFormat, AnimationExportCapability> = {
    gif: { supported: worker, reason: worker ? undefined : "Для GIF нужен браузер с Web Workers" },
    "png-sequence": { supported: worker, reason: worker ? undefined : "Для архива кадров нужен браузер с Web Workers" },
    png: { supported: browser }, minepose: { supported: true },
    webm: { supported: false, reason: "Этот браузер не поддерживает кодирование WebM через WebCodecs. Используйте GIF или PNG-кадры." },
    mp4: { supported: false, reason: "В этом браузере недоступен кодировщик H.264. Используйте WebM, GIF или PNG-кадры." },
  };
  if (!browser || typeof VideoEncoder === "undefined") return result;
  try {
    const { getFirstEncodableVideoCodec } = await import("mediabunny");
    const [webm, mp4] = await Promise.all([
      getFirstEncodableVideoCodec(["vp8", "vp9"], { width: 512, height: 512, frameRate: 30 }),
      getFirstEncodableVideoCodec(["avc"], { width: 512, height: 512, frameRate: 30 }),
    ]);
    if (webm) result.webm = { supported: true };
    if (mp4) result.mp4 = { supported: true };
  } catch { return result; }
  return result;
}

function encoderWorker(signal: AbortSignal) {
  const worker = new Worker(new URL("../workers/animation-export-worker.ts", import.meta.url), { type: "module" });
  let nextId = 1;
  const pending = new Map<number, { resolve: (value: WorkerResponse) => void; reject: (reason: Error) => void }>();
  const rejectAll = (error: Error) => { for (const item of pending.values()) item.reject(error); pending.clear(); };
  const abort = () => { worker.terminate(); rejectAll(abortError()); };
  signal.addEventListener("abort", abort, { once: true });
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    if (!data.id && data.kind === "error") { rejectAll(new Error(data.message || "Ошибка кодирования")); return; }
    const task = pending.get(data.id); if (!task) return;
    pending.delete(data.id);
    if (data.kind === "error") task.reject(new Error(data.message || "Не удалось закодировать кадр"));
    else task.resolve(data);
  };
  worker.onerror = () => rejectAll(new Error("Не удалось запустить кодировщик. Проверьте поддержку Web Workers в браузере."));
  return {
    call(data: WorkerRequest, transfer: Transferable[] = []) {
      checkAbort(signal);
      return new Promise<WorkerResponse>((resolve, reject) => {
        const id = nextId++; pending.set(id, { resolve, reject });
        try { worker.postMessage({ ...data, id }, transfer); } catch (error) { pending.delete(id); reject(error); }
      });
    },
    close() { signal.removeEventListener("abort", abort); worker.terminate(); rejectAll(abortError()); },
  };
}

async function canvasBlob(canvas: HTMLCanvasElement, signal: AbortSignal) {
  return abortable(new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Не удалось получить PNG-кадр")), "image/png")), signal);
}

export async function renderAnimationAudio(project: AnimationProject, start: number, end: number, signal: AbortSignal): Promise<AudioBuffer | null> {
  const tracks = project.objects.filter(object => object.type === "audio" && object.audio && object.visible && !object.audio.muted);
  if (!tracks.length) return null;
  if (typeof OfflineAudioContext === "undefined") throw new Error("В этом браузере недоступно сведение звука. Экспортируйте без звука.");
  const sampleRate = 48_000;
  const offline = new OfflineAudioContext(2, Math.max(1, Math.ceil((end - start) * sampleRate)), sampleRate);
  for (const object of tracks) {
    checkAbort(signal);
    const audio = object.audio!;
    if (!/^data:(audio\/[\w.+-]+|application\/octet-stream);base64,/i.test(audio.dataUrl)) throw new Error("Аудиодорожка не содержит встроенный звуковой файл");
    const file = await abortable(fetch(audio.dataUrl).then(response => response.arrayBuffer()), signal);
    const buffer = await abortable(offline.decodeAudioData(file), signal);
    const trimStart = Math.max(0, Math.min(buffer.duration, audio.trimStart));
    const trimEnd = Math.min(buffer.duration, audio.trimEnd > trimStart ? audio.trimEnd : buffer.duration);
    const clipStart = audio.offset, clipEnd = clipStart + trimEnd - trimStart;
    const from = Math.max(start, clipStart), to = Math.min(end, clipEnd);
    if (to <= from) continue;
    const source = offline.createBufferSource(), gain = offline.createGain();
    source.buffer = buffer; source.connect(gain); gain.connect(offline.destination);
    const values = new Float32Array(128);
    for (let index = 0; index < values.length; index++) {
      const timelineTime = from + (to - from) * index / (values.length - 1);
      const fadeIn = audio.fadeIn > 0 ? Math.min(1, Math.max(0, (timelineTime - clipStart) / audio.fadeIn)) : 1;
      const fadeOut = audio.fadeOut > 0 ? Math.min(1, Math.max(0, (clipEnd - timelineTime) / audio.fadeOut)) : 1;
      values[index] = Math.max(0, audio.volume) * object.opacity * fadeIn * fadeOut;
    }
    gain.gain.setValueCurveAtTime(values, from - start, to - from);
    source.start(from - start, trimStart + from - clipStart, to - from);
  }
  return abortable(offline.startRendering(), signal);
}

async function exportVideo(options: AnimationExportOptions, times: number[]) {
  const { project, renderFrame, signal, onProgress } = options;
  const settings = project.export;
  if (typeof VideoEncoder === "undefined") throw new Error("В этом браузере недоступен WebCodecs. Выберите GIF или последовательность PNG.");
  if (settings.format === "mp4" && (settings.width % 2 || settings.height % 2)) throw new Error("Для MP4 укажите чётную ширину и высоту кадра");
  const { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource, Quality, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec } = await import("mediabunny");
  checkAbort(signal);
  const quality = new Quality({ quality: Math.min(1, Math.max(0, settings.quality)) });
  const codec = await getFirstEncodableVideoCodec(settings.format === "mp4" ? ["avc"] : ["vp8", "vp9"], { width: settings.width, height: settings.height, frameRate: settings.fps, quality });
  if (!codec) throw new Error("Браузер не может закодировать видео с этими параметрами. Уменьшите разрешение или выберите GIF / PNG.");
  const { start, end } = range(project);
  const audio = settings.audio ? await (options.renderAudio ? abortable(options.renderAudio(start, end), signal) : renderAnimationAudio(project, start, end, signal)) : null;
  checkAbort(signal);
  const audioCodec = audio ? await getFirstEncodableAudioCodec(settings.format === "mp4" ? ["aac"] : ["opus"], { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate }) : null;
  if (audio && !audioCodec) throw new Error("В этом браузере недоступно кодирование звука для выбранного видео. Отключите звук или выберите другой формат.");
  const canvas = document.createElement("canvas"); canvas.width = settings.width; canvas.height = settings.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Не удалось подготовить кадр видео");
  const target = new BufferTarget();
  const output = new Output({ target, format: settings.format === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat() });
  const source = new CanvasSource(canvas, { codec, quality, latencyMode: "quality", keyFrameInterval: 2, alpha: "discard" });
  output.addVideoTrack(source, { frameRate: settings.fps });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: new Quality("high") }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  const abort = () => { void output.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await abortable(output.start(), signal);
    let audioError: unknown;
    const audioTask = audioSource && audio ? audioSource.add(audio).then(() => audioSource.close()).catch(error => { audioError = error; }) : Promise.resolve();
    for (let index = 0; index < times.length; index++) {
      checkAbort(signal);
      if (audioError) throw audioError;
      const frame = await abortable(renderFrame(times[index], settings.width, settings.height, false), signal);
      checkAbort(signal);
      if (frame.width !== settings.width || frame.height !== settings.height) throw new Error("Рендерер вернул кадр неправильного размера");
      context.fillStyle = /^#[\da-f]{6}$/i.test(project.scene.background) ? project.scene.background : "#17131f";
      context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const timestamp = index / settings.fps, duration = Math.min(1 / settings.fps, end - start - timestamp);
      await abortable(source.add(timestamp, duration, { keyFrame: index % (settings.fps * 2) === 0 }), signal);
      onProgress((index + 1) / times.length * .96);
      await yieldTask();
    }
    source.close();
    await abortable(audioTask, signal);
    if (audioError) throw audioError;
    await abortable(output.finalize(), signal);
    checkAbort(signal);
    if (!target.buffer) throw new Error("Кодировщик не вернул видеофайл");
    onProgress(1);
    return new Blob([target.buffer], { type: settings.format === "mp4" ? "video/mp4" : "video/webm" });
  } catch (error) { await output.cancel().catch(() => {}); throw error; }
  finally { signal.removeEventListener("abort", abort); }
}

export async function exportAnimation(options: AnimationExportOptions): Promise<{ blob: Blob; filename: string }> {
  const { project, signal, renderFrame, onProgress } = options;
  checkAbort(signal); onProgress(0);
  const filename = safeName(project.name), settings = project.export;
  if (settings.format === "minepose") {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" }); onProgress(1);
    return { blob, filename: `${filename}.minepose` };
  }
  const times = getAnimationExportFrameTimes(project), { start, end } = range(project);
  if (settings.format === "png") {
    const canvas = await abortable(renderFrame(times[0], settings.width, settings.height, settings.transparent), signal);
    if (canvas.width !== settings.width || canvas.height !== settings.height) throw new Error("Рендерер вернул кадр неправильного размера");
    const blob = await canvasBlob(canvas, signal); checkAbort(signal); onProgress(1);
    return { blob, filename: `${filename}-${String(Math.round(times[0] * project.fps)).padStart(6, "0")}.png` };
  }
  if (settings.format === "webm" || settings.format === "mp4") return { blob: await exportVideo(options, times), filename: `${filename}.${settings.format}` };
  if (settings.format !== "gif" && settings.format !== "png-sequence") throw new Error("Выберите поддерживаемый формат экспорта");
  if (settings.audio && project.objects.some(object => object.type === "audio" && object.audio && !object.audio.muted && object.visible)) throw new Error("GIF и PNG-кадры не содержат звук. Отключите звук или выберите видео.");
  if (typeof Worker === "undefined") throw new Error("Для экспорта нужен браузер с Web Workers");
  const encoder = encoderWorker(signal);
  try {
    await encoder.call({ action: "init", format: settings.format, width: settings.width, height: settings.height, fps: settings.fps, quality: settings.quality, transparent: settings.transparent, loop: settings.loop, manifest: JSON.stringify({ version: 1, fps: settings.fps, width: settings.width, height: settings.height, start, end, frames: times.map((time, index) => ({ file: `frame-${String(index).padStart(6, "0")}.png`, time, duration: Math.min(1 / settings.fps, end - time) })) }, null, 2) });
    for (let index = 0; index < times.length; index++) {
      checkAbort(signal);
      const canvas = await abortable(renderFrame(times[index], settings.width, settings.height, settings.transparent), signal);
      checkAbort(signal);
      if (canvas.width !== settings.width || canvas.height !== settings.height) throw new Error("Рендерер вернул кадр неправильного размера");
      if (settings.format === "gif") {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Не удалось прочитать пиксели кадра");
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const delay = Math.max(10, (Math.round(Math.min((index + 1) / settings.fps, end - start) * 100) - Math.round(index / settings.fps * 100)) * 10);
        await encoder.call({ action: "gif-frame", pixels: pixels.buffer, delay }, [pixels.buffer as ArrayBuffer]);
      } else {
        const bytes = await (await canvasBlob(canvas, signal)).arrayBuffer(); checkAbort(signal);
        await encoder.call({ action: "png-frame", bytes, name: `frame-${String(index).padStart(6, "0")}.png` }, [bytes]);
      }
      onProgress((index + 1) / times.length * .95);
      await yieldTask();
    }
    const result = await encoder.call({ action: "finish" });
    checkAbort(signal);
    if (!result.buffer) throw new Error("Кодировщик не вернул файл");
    onProgress(1);
    return { blob: new Blob([result.buffer], { type: result.mime || "application/octet-stream" }), filename: `${filename}.${settings.format === "gif" ? "gif" : "zip"}` };
  } finally { encoder.close(); }
}
