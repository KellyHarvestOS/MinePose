"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Check, Download, LoaderCircle, X } from "lucide-react";
import type { AnimationProject, ExportFormat } from "@/lib/animation";
import { animationFormatSupportsAudio, animationFormatSupportsTransparency, exportAnimation, getAnimationExportCapabilities, type AnimationExportCapability } from "@/lib/animation-export";
import { downloadDataUrl } from "@/lib/files";
import type { AnimationViewportHandle } from "./animation-viewport";

type Props = { project: AnimationProject; viewport: RefObject<AnimationViewportHandle | null>; onChange: (project: AnimationProject) => void; onClose: () => void; onNotify: (message: string) => void };
const formats: { id: ExportFormat; name: string; caption: string }[] = [{ id: "gif", name: "GIF", caption: "Короткая анимация" }, { id: "webm", name: "WebM", caption: "Видео VP9 / VP8" }, { id: "mp4", name: "MP4", caption: "Видео H.264" }, { id: "png-sequence", name: "PNG-кадры", caption: "ZIP с последовательностью" }, { id: "png", name: "PNG", caption: "Выбранный кадр" }, { id: "minepose", name: ".minepose", caption: "Редактируемый проект" }];

export default function AnimationExportDialog({ project, viewport, onChange, onClose, onNotify }: Props) {
  const [capabilities, setCapabilities] = useState<Record<ExportFormat, AnimationExportCapability> | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; format: ExportFormat; filename: string } | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const close = useRef(onClose); close.current = onClose;
  const dialog = useRef<HTMLElement>(null);
  const busy = progress !== null;
  const settings = project.export;
  useEffect(() => { let active = true; void getAnimationExportCapabilities().then(value => { if (active) setCapabilities(value); }); return () => { active = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (controller.current) controller.current.abort(); else close.current(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),video") || []);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", keyboard); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  function patch(change: Partial<AnimationProject["export"]>) { onChange({ ...project, export: { ...project.export, ...change } }); }
  async function run() {
    if (busy) return;
    setError(""); setProgress(0);
    const abort = new AbortController(); controller.current = abort;
    try {
      if (settings.format !== "minepose") await viewport.current?.waitReady();
      const output = await exportAnimation({ project: structuredClone(project), signal: abort.signal, onProgress: setProgress, renderFrame: async (time, width, height, transparent) => { const renderer = viewport.current; if (!renderer) throw new Error("3D-сцена недоступна"); return renderer.captureFrame(time, width, height, transparent); } });
      const url = URL.createObjectURL(output.blob);
      setResult({ url, format: settings.format, filename: output.filename });
      downloadDataUrl(url, output.filename);
      onNotify("Анимация экспортирована");
    } catch (failure) {
      if (abort.signal.aborted) setError("Экспорт отменён. Проект сохранён без изменений.");
      else setError(failure instanceof Error ? failure.message : "Не удалось экспортировать анимацию");
    } finally { controller.current = null; setProgress(null); }
  }
  return <div className="as-dialog-backdrop" onPointerDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={dialog} className="as-dialog as-export-dialog" role="dialog" aria-modal="true" aria-labelledby="as-export-title"><header><div><span className="as-eyebrow">ИЗ МАСТЕРСКОЙ В МИР</span><h2 id="as-export-title">Экспорт анимации</h2></div><button aria-label="Закрыть экспорт анимации" disabled={busy} onClick={onClose}><X size={18} /></button></header><fieldset disabled={busy} className="as-export-fields"><div className="as-format-grid">{formats.map(format => <button type="button" key={format.id} disabled={!capabilities?.[format.id].supported} aria-pressed={settings.format === format.id} title={capabilities?.[format.id].reason || format.caption} className={settings.format === format.id ? "is-selected" : ""} onClick={() => patch({ format: format.id, transparent: animationFormatSupportsTransparency(format.id) && settings.transparent, audio: animationFormatSupportsAudio(format.id) && settings.audio })}><strong>{format.name}</strong><small>{capabilities?.[format.id].supported ? format.caption : capabilities?.[format.id].reason || "Проверяем поддержку…"}</small>{settings.format === format.id && <Check size={13} />}</button>)}</div>{settings.format !== "minepose" && <><label className="as-field"><span>Размер кадра</span><select aria-label="Шаблон разрешения анимации" value={`${settings.width}x${settings.height}`} onChange={event => { const [width, height] = event.target.value.split("x").map(Number); if (width && height) patch({ width, height }); }}><option value="custom">Свой размер</option>{[[512, 512], [1024, 1024], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]].map(([width, height]) => <option value={`${width}x${height}`} key={width}>{width} × {height}</option>)}</select></label><div className="as-field-grid"><label className="as-field"><span>Ширина</span><input type="number" aria-label="Ширина экспорта анимации" min={16} max={8192} value={settings.width} onChange={event => patch({ width: Number(event.target.value) })} /></label><label className="as-field"><span>Высота</span><input type="number" aria-label="Высота экспорта анимации" min={16} max={8192} value={settings.height} onChange={event => patch({ height: Number(event.target.value) })} /></label></div><div className="as-field-grid"><label className="as-field"><span>Начало, с</span><input type="number" aria-label="Начало экспорта" min={0} max={project.duration} step={1 / settings.fps} value={settings.start} onChange={event => patch({ start: Number(event.target.value) })} /></label><label className="as-field"><span>Конец, с</span><input type="number" aria-label="Конец экспорта" min={0} max={project.duration} step={1 / settings.fps} value={settings.end} onChange={event => patch({ end: Number(event.target.value) })} /></label></div><div className="as-field-grid"><label className="as-field"><span>Частота кадров</span><select aria-label="FPS экспорта" value={settings.fps} onChange={event => patch({ fps: Number(event.target.value) as 24 | 30 | 60 })}>{[24, 30, 60].map(value => <option value={value} key={value}>{value} FPS</option>)}</select></label><label className="as-field"><span>Качество · {Math.round(settings.quality * 100)}%</span><input type="range" aria-label="Качество экспорта" min={.2} max={1} step={.05} value={settings.quality} onChange={event => patch({ quality: Number(event.target.value) })} /></label></div><label className="as-field"><span>Итоговая камера</span><select aria-label="Камера экспорта" value={settings.cameraId || project.scene.activeCameraId || ""} onChange={event => patch({ cameraId: event.target.value || undefined })}>{project.objects.filter(object => object.type === "camera").map(object => <option key={object.id} value={object.id}>{object.name}</option>)}</select></label><label className="as-check"><input type="checkbox" disabled={!animationFormatSupportsTransparency(settings.format)} checked={settings.transparent && animationFormatSupportsTransparency(settings.format)} onChange={event => patch({ transparent: event.target.checked })} /><span>Прозрачный фон {settings.format === "webm" || settings.format === "mp4" ? "· для видео используется цвет сцены" : ""}</span></label>{animationFormatSupportsAudio(settings.format) && <label className="as-check"><input type="checkbox" disabled={!project.objects.some(object => object.audio && !object.audio.muted)} checked={settings.audio} onChange={event => patch({ audio: event.target.checked })} /><span>Звук из аудиодорожек{!project.objects.some(object => object.audio) ? " · сначала импортируй аудиофайл" : ""}</span></label>}{settings.format === "gif" && <label className="as-check"><input type="checkbox" checked={settings.loop} onChange={event => patch({ loop: event.target.checked })} /><span>Повторять GIF</span></label>}</>}</fieldset>{error && <p className="as-error" role="alert">{error}</p>}{busy && <div className="as-export-progress" role="progressbar" aria-label="Экспорт анимации" aria-valuenow={Math.round((progress || 0) * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${(progress || 0) * 100}%` }} /><strong>{Math.round((progress || 0) * 100)}%</strong></div>}{result && <div className="as-export-result">{["gif", "png"].includes(result.format) ? <img src={result.url} alt="Результат экспорта анимации" /> : ["webm", "mp4"].includes(result.format) ? <video src={result.url} controls /> : <p><Check size={16} />{result.filename}</p>}<button className="as-secondary-button" onClick={() => downloadDataUrl(result.url, result.filename)}><Download size={14} />Скачать ещё раз</button></div>}<footer>{busy ? <button className="as-secondary-button" onClick={() => controller.current?.abort()}>Отменить экспорт</button> : <button className="as-primary-button" disabled={!capabilities?.[settings.format].supported} onClick={run}>{capabilities ? <Download size={15} /> : <LoaderCircle size={15} />}Экспортировать анимацию</button>}<span>Кадры рассчитываются по времени проекта</span></footer></section></div>;
}
