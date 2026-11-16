"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, Camera, Check, ChevronRight, Clock3, Film, Layers3, Maximize2, Pause, Play, RotateCcw, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import type { AnimationTemplate } from "@/lib/animation";
import { ANIMATION_TEMPLATES, ANIMATION_TEMPLATE_CATEGORIES, animationTemplateSummary, type AnimationTemplateDefinition } from "@/lib/animation-templates";
import AnimationTemplatePreview from "./animation-template-preview";
import "./animation-template-library.css";

type Props = { skin: string; slim: boolean; onCreate: (id: AnimationTemplate) => void };
type Summary = ReturnType<typeof animationTemplateSummary>;
const normalize = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е");

function TemplatePreviewDialog({ template, summary, skin, slim, onClose, onCreate }: { template: AnimationTemplateDefinition; summary: Summary; skin: string; slim: boolean; onClose: () => void; onCreate: () => void }) {
  const [playing, setPlaying] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [time, setTime] = useState(0);
  const modal = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const timeRef = useRef(0);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const toggleRef = useRef(() => setPlaying(value => !value));

  useEffect(() => {
    const element = stage.current; if (!element) return;
    const resize = () => { const { width, height } = element.getBoundingClientRect(), ratio = summary.width / summary.height; const fittedWidth = Math.min(width, height * ratio); setFrameSize({ width: fittedWidth, height: fittedWidth / ratio }); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, [summary.width, summary.height]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
      const target = event.target as HTMLElement;
      if (event.code === "Space" && !["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(target.tagName)) { event.preventDefault(); toggleRef.current(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(modal.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex='0']") || []), first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || !modal.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", keyboard); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!playing) return;
    let frame = 0, previous = performance.now(), lastUpdate = 0;
    const tick = (now: number) => {
      timeRef.current = (timeRef.current + Math.min(.2, (now - previous) / 1000)) % summary.duration; previous = now;
      if (now - lastUpdate >= 1000 / 30) { setTime(timeRef.current); lastUpdate = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, summary.duration]);
  function seek(value: number) { setPlaying(false); timeRef.current = Math.max(0, Math.min(summary.duration, value)); setTime(timeRef.current); }

  return createPortal(<div className="atl-modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="atl-modal" ref={modal} role="dialog" aria-modal="true" aria-label={`Предпросмотр шаблона ${template.name}`}>
    <header className="atl-modal-header"><div><span>БИБЛИОТЕКА АНИМАЦИЙ / ПРЕДПРОСМОТР</span><h2>{template.name}</h2></div><button ref={closeButton} aria-label="Закрыть предпросмотр шаблона" onClick={onClose}><X size={20} /></button></header>
    <div className="atl-modal-layout"><div className="atl-modal-viewer"><div ref={stage} className={`atl-modal-stage ${summary.transparent ? "is-transparent" : ""}`}><div className="atl-modal-frame" style={frameSize ? { width: frameSize.width, height: frameSize.height } : { aspectRatio: `${summary.width} / ${summary.height}` }}><AnimationTemplatePreview template={template.id} skin={skin} slim={slim} time={time} playing={playing} className="atl-large-preview" /></div><span className="atl-modal-view-label"><Camera size={12} />3D-предпросмотр</span></div><div className="atl-modal-transport"><button className="atl-modal-play" aria-label={playing ? "Приостановить шаблон" : "Воспроизвести шаблон"} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><button className="atl-modal-reset" aria-label="В начало шаблона" title="В начало" onClick={() => seek(0)}><RotateCcw size={15} /></button><label className="atl-modal-scrub"><input type="range" min={0} max={summary.duration} step={1 / summary.fps} value={time} aria-label="Время предпросмотра шаблона" onChange={event => seek(Number(event.target.value))} /></label><span className="atl-modal-time">{time.toFixed(1)} <i>/ {summary.duration.toFixed(1)} с</i></span></div></div>
      <aside className="atl-modal-details"><span className="atl-modal-category">{template.categoryLabel}</span><p>{template.detail}</p><dl><div><dt><Clock3 size={13} />Длительность</dt><dd>{summary.duration} с</dd></div><div><dt><Film size={13} />Частота кадров</dt><dd>{summary.fps} FPS</dd></div><div><dt><UserRound size={13} />Персонажи</dt><dd>{summary.characters}</dd></div><div><dt><Layers3 size={13} />Дорожки</dt><dd>{summary.tracks}</dd></div></dl><div className="atl-modal-tags">{template.tags.slice(0, 2).map(tag => <span key={tag}><Check size={11} />{tag}</span>)}</div><div className="atl-modal-create"><span>Твой скин откроется вместе со сценой.<br />Любой ключ и предмет можно изменить.</span><button aria-label={`Создать анимацию из шаблона ${template.name}`} onClick={onCreate}>Создать анимацию<ChevronRight size={16} /></button></div></aside>
    </div>
  </section></div>, document.body);
}

export default function AnimationTemplateLibrary({ skin, slim, onCreate }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [active, setActive] = useState<AnimationTemplate | null>(null);
  const [preview, setPreview] = useState<AnimationTemplateDefinition | null>(null);
  const summaries = useMemo(() => new Map(ANIMATION_TEMPLATES.map(template => [template.id, animationTemplateSummary(template.id)])), []);
  const templates = useMemo(() => ANIMATION_TEMPLATES.filter(template => (category === "all" || template.category === category) && normalize(`${template.name} ${template.categoryLabel} ${template.description} ${template.tags.join(" ")}`).includes(normalize(query.trim()))), [category, query]);

  return <section className="atl-library" aria-labelledby="atl-library-title">
    <div className="atl-heading"><div><span className="atl-eyebrow"><Film size={13} />БИБЛИОТЕКА АНИМАЦИЙ</span><h2 id="atl-library-title">Начни с идеи<span>.</span></h2><p>Выбери движение. Остальное сделай своим.</p></div><span className="atl-library-count"><span />{ANIMATION_TEMPLATES.length} готовых сцен</span></div>
    <div className="atl-toolbar"><div className="atl-filters" role="group" aria-label="Категории шаблонов анимации">{ANIMATION_TEMPLATE_CATEGORIES.map(value => <button key={value.id} className={category === value.id ? "is-active" : ""} aria-pressed={category === value.id} onClick={() => setCategory(value.id)}>{value.label}</button>)}</div><label className="atl-search"><Search size={15} /><input aria-label="Поиск шаблонов анимации" placeholder="Найти свою идею…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Очистить поиск шаблонов" onClick={() => setQuery("")}><X size={14} /></button>}</label></div>
    <div className="atl-results-label" aria-live="polite"><span>{templates.length === ANIMATION_TEMPLATES.length ? "ВСЕ ШАБЛОНЫ" : `НАЙДЕНО: ${templates.length}`}</span><span><SlidersHorizontal size={11} />Всё можно настроить в редакторе</span></div>
    {templates.length ? <div className="atl-grid">{templates.map(template => { const summary = summaries.get(template.id)!; return <article className={`atl-card ${active === template.id ? "is-active" : ""}`} key={template.id} data-template={template.id} onMouseEnter={() => setActive(template.id)} onMouseLeave={() => setActive(previous => previous === template.id ? null : previous)} onFocusCapture={() => setActive(template.id)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setActive(previous => previous === template.id ? null : previous); }}>
      <div className={`atl-card-preview ${summary.transparent ? "is-transparent" : ""}`}><AnimationTemplatePreview template={template.id} skin={skin} slim={slim} playing={active === template.id && !preview} /><span className="atl-preview-kind"><span />{template.id === "empty" ? "3D-СЦЕНА" : "3D-АНИМАЦИЯ"}</span><button className="atl-preview-action" aria-label={`Предпросмотр шаблона: ${template.name}`} onClick={() => setPreview(template)}><Play size={12} fill="currentColor" /><span>Смотреть</span><Maximize2 size={12} /></button>{summary.transparent && <span className="atl-preview-alpha">PNG / GIF · ALPHA</span>}</div>
      <div className="atl-card-content"><div className="atl-card-category"><span>{template.categoryLabel}</span><span><Clock3 size={11} />{summary.duration} с</span></div><h3>{template.name}</h3><p>{template.description}</p><div className="atl-card-footer"><span><UserRound size={13} />{summary.characters === 1 ? "1 персонаж" : `${summary.characters} персонажа`}<i />{summary.fps} FPS</span><button className="atl-create-button" aria-label={`Создать анимацию: ${template.name}`} onClick={() => onCreate(template.id)}>Создать<ArrowUpRight size={15} /></button></div></div>
    </article>; })}</div> : <div className="atl-empty"><Search size={26} /><h3>Такая идея ещё не нашлась</h3><p>Попробуй другое название или посмотри все шаблоны.</p><button onClick={() => { setQuery(""); setCategory("all"); }}>Сбросить фильтры</button></div>}
    <div className="atl-library-note"><span><Check size={12} />Настоящие сцены с редактируемыми ключами</span><span>Твой скин · Твой ритм · Твоя история</span></div>
    {preview && <TemplatePreviewDialog template={preview} summary={summaries.get(preview.id)!} skin={skin} slim={slim} onClose={() => setPreview(null)} onCreate={() => { const id = preview.id; setPreview(null); onCreate(id); }} />}
  </section>;
}
