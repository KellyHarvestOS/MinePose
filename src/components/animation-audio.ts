import type { AnimationProject, StudioObject } from "@/lib/animation";
import { readImage } from "@/lib/files";

export async function importAnimationAudio(file: File): Promise<StudioObject["audio"]> {
  if (file.size > 20 * 1024 * 1024 || (!file.type.startsWith("audio/") && !/\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(file.name))) throw new Error("Выберите аудиофайл размером до 20 МБ");
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0), peaks = Array.from({ length: 256 }, (_, index) => { const start = Math.floor(index / 256 * data.length), end = Math.min(data.length, Math.floor((index + 1) / 256 * data.length)); let peak = 0; for (let sample = start; sample < end; sample += Math.max(1, Math.floor((end - start) / 150))) peak = Math.max(peak, Math.abs(data[sample])); return Number(peak.toFixed(4)); });
    return { dataUrl: await readImage(file), duration: buffer.duration, offset: 0, trimStart: 0, trimEnd: buffer.duration, volume: .8, fadeIn: 0, fadeOut: 0, muted: false, peaks };
  } finally { await context.close(); }
}

export class AnimationAudioTransport {
  private entries = new Map<string, { url: string; element: HTMLAudioElement }>();
  sync(project: AnimationProject, time: number, playing: boolean, speed: number) {
    const available = new Set(project.objects.filter(value => value.audio).map(value => value.id));
    for (const [id, value] of this.entries) if (!available.has(id)) { value.element.pause(); value.element.src = ""; this.entries.delete(id); }
    for (const object of project.objects) {
      const sound = object.audio; if (!sound) continue;
      let entry = this.entries.get(object.id);
      if (!entry || entry.url !== sound.dataUrl) { entry?.element.pause(); entry = { url: sound.dataUrl, element: new Audio(sound.dataUrl) }; entry.element.preload = "auto"; this.entries.set(object.id, entry); }
      const element = entry.element, local = time - sound.offset, length = Math.max(0, sound.trimEnd - sound.trimStart);
      if (!playing || sound.muted || !object.visible || local < 0 || local >= length) { element.pause(); continue; }
      const target = sound.trimStart + local;
      if (Math.abs(element.currentTime - target) > .18) element.currentTime = target;
      element.playbackRate = speed;
      const fadeIn = sound.fadeIn ? Math.min(1, local / sound.fadeIn) : 1, fadeOut = sound.fadeOut ? Math.min(1, (length - local) / sound.fadeOut) : 1;
      element.volume = Math.max(0, Math.min(1, sound.volume * fadeIn * fadeOut));
      if (element.paused) void element.play().catch(() => {});
    }
  }
  dispose() { for (const value of this.entries.values()) { value.element.pause(); value.element.src = ""; value.element.load(); } this.entries.clear(); }
}
