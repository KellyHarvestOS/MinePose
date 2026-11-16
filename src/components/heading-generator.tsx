"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Download, LoaderCircle, Moon, RotateCcw, SlidersHorizontal, Sparkles, Sun } from "lucide-react";
import { DEFAULT_HEADING, HEADING_FONTS, type HeadingOptions } from "@/lib/headings";
import { renderHeading } from "@/lib/heading-renderer";
import { downloadDataUrl } from "@/lib/files";
import "./heading-generator.css";

type Props = {
  onNotify: (message: string) => void;
};
const COLORS = ["#ffffff", "#c395ff", "#9254e8", "#ff74bc", "#ff626a", "#ffad4f", "#ffdf69", "#88e492", "#65d9db", "#73adff", "#a1a1ae", "#111114"];
const STYLES: { name: string; color: string; endColor: string; gradient: boolean; depth: number; outlineWidth: number }[] = [
  { name: "Классика", color: "#ffffff", endColor: "#b5b5bd", gradient: true, depth: 4, outlineWidth: 0 },
  { name: "MinePose", color: "#e5caff", endColor: "#a261ee", gradient: true, depth: 5, outlineWidth: 1 },
  { name: "Золото", color: "#fff1a1", endColor: "#ffae32", gradient: true, depth: 5, outlineWidth: 1 },
  { name: "Изумруд", color: "#baffbc", endColor: "#3acb95", gradient: true, depth: 4, outlineWidth: 1 },
];

function ColorField({ label, value, onChange, id }: { label: string; value: string; onChange: (value: string) => void; id: string }) {
  const [hex, setHex] = useState(value.toUpperCase());
  useEffect(() => setHex(value.toUpperCase()), [value]);
  function commit() { if (/^#[\da-f]{6}$/i.test(hex)) onChange(hex.toLowerCase()); else setHex(value.toUpperCase()); }
  return <div className="hg-color-field">
    <label htmlFor={id}>{label}</label>
    <div className="hg-color-entry">
      <label className="hg-color-wheel" style={{ background: value }}><input aria-label={`${label} — палитра`} type="color" value={value} onChange={event => onChange(event.target.value)} /><span className="hg-color-wheel-mark" /></label>
      <input id={id} aria-label={label} spellCheck={false} maxLength={7} value={hex} onChange={event => { const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`; setHex(next.toUpperCase()); if (/^#[\da-f]{6}$/i.test(next)) onChange(next.toLowerCase()); }} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} />
    </div>
  </div>;
}

function RangeField({ label, value, min, max, suffix = "", onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="hg-range-field"><span>{label}<output>{value}{suffix}</output></span><input type="range" aria-label={label} min={min} max={max} step={1} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}

export default function HeadingGenerator({ onNotify }: Props) {
  const [options, setOptions] = useState<HeadingOptions>(() => ({ ...DEFAULT_HEADING }));
  const [lightPreview, setLightPreview] = useState(false);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const revision = useRef(0);
  const notifyRef = useRef(onNotify); notifyRef.current = onNotify;
  const hasText = Boolean(options.text.trim());
  const selectedFont = HEADING_FONTS.find(font => font.id === options.font) || HEADING_FONTS[0];
  const update = (patch: Partial<HeadingOptions>) => setOptions(previous => ({ ...previous, ...patch }));

  useEffect(() => {
    const current = ++revision.current;
    setRendering(true); setError("");
    const output = document.createElement("canvas");
    void renderHeading(output, options).then(() => {
      if (current !== revision.current || !canvasRef.current) return;
      const canvas = canvasRef.current; canvas.width = output.width; canvas.height = output.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Браузер не поддерживает предпросмотр изображения");
      context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(output, 0, 0);
    }).catch(reason => {
      if (current !== revision.current) return;
      const message = reason instanceof Error ? reason.message : "Не удалось подготовить заголовок";
      setError(message); notifyRef.current(message);
    }).finally(() => { if (current === revision.current) setRendering(false); });
    return () => { if (revision.current === current) revision.current++; };
  }, [options]);

  async function makeCanvas(transparent = options.transparent) {
    const canvas = document.createElement("canvas");
    await renderHeading(canvas, { ...options, transparent });
    return canvas;
  }
  async function perform(action: "copy" | "download") {
    if (!hasText || busy) return;
    setBusy(action);
    try {
      if (action === "copy") {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Копирование изображения недоступно в этом браузере. Скачай PNG.");
        const blobPromise = makeCanvas().then(canvas => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Не удалось создать PNG")), "image/png")));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
        onNotify("Заголовок скопирован. Можно вставить его как изображение.");
      } else if (action === "download") {
        const canvas = await makeCanvas(); downloadDataUrl(canvas.toDataURL("image/png"), "minepose-title.png"); onNotify("Заголовок 1600 × 480 сохранён");
      }
    } catch (reason) {
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError";
      onNotify(denied ? "Браузер не разрешил доступ к буферу обмена. Разреши копирование или скачай PNG." : reason instanceof Error ? reason.message : "Не удалось подготовить изображение");
    } finally { setBusy(null); }
  }

  return <div className="hg-generator">
    <p className="hg-intro">Собери надпись для своего мира: выбери шрифт, цвет и объём. Сохрани PNG с прозрачным фоном или скопируй изображение.</p>
    <section className="hg-preview-panel" aria-label="Предпросмотр изображения">
      <div className="hg-preview-toolbar"><span className="hg-eyebrow">ПРЕДПРОСМОТР<span className={`hg-live-dot ${rendering ? "is-rendering" : ""}`} /></span><div className="hg-preview-actions"><div className="hg-preview-themes" aria-label="Подложка предпросмотра"><button aria-label="Тёмная подложка" aria-pressed={!lightPreview} className={!lightPreview ? "is-active" : ""} onClick={() => setLightPreview(false)}><Moon size={13} /></button><button aria-label="Светлая подложка" aria-pressed={lightPreview} className={lightPreview ? "is-active" : ""} onClick={() => setLightPreview(true)}><Sun size={14} /></button></div><span className="hg-toolbar-separator" /><button className="hg-reset" onClick={() => setOptions({ ...DEFAULT_HEADING })} title="Сбросить настройки" aria-label="Сбросить заголовок"><RotateCcw size={13} /><span>Сбросить</span></button></div></div>
      <div className={`hg-preview-stage ${lightPreview ? "is-light" : ""} ${options.transparent ? "is-checkered" : ""}`}>
        <canvas ref={canvasRef} className="hg-preview-canvas" role="img" aria-label={`Предпросмотр заголовка: ${options.text}`} />
        {!hasText && <span className="hg-preview-empty">Здесь появится твой заголовок</span>}
        {error && <span className="hg-preview-error" role="alert">{error}</span>}
        {rendering && <span className="hg-preview-loading"><LoaderCircle size={13} className="animate-spin" />Подготовка шрифта…</span>}
      </div>
      <div className="hg-preview-caption"><span>{selectedFont.label}<span className="hg-caption-divider">/</span>{options.transparent ? "Прозрачный фон" : "Цветной фон"}</span><span>1600 × 480 <small>PNG</small></span></div>
    </section>

    <div className="hg-controls-grid">
      <section className="hg-control-panel hg-type-panel">
        <div className="hg-section-heading"><span className="hg-step">01</span><h2>Текст и шрифт</h2></div>
        <label className="hg-label" htmlFor="hg-title">Заголовок</label>
        <textarea id="hg-title" className="hg-text-input" aria-label="Текст заголовка" rows={2} maxLength={90} value={options.text} onChange={event => update({ text: event.target.value.split("\n").slice(0, 2).join("\n") })} placeholder="ТВОЁ ПРИКЛЮЧЕНИЕ" />
        <div className="hg-input-help"><span>Enter — новая строка. До двух строк.</span><span>{options.text.length}/90</span></div>
        <div className="hg-font-label"><span className="hg-label">Выбери характер надписи</span><span>8 шрифтов · Кириллица</span></div>
        <div className="hg-font-grid" role="group" aria-label="Шрифт заголовка">
          {HEADING_FONTS.map(font => <button key={font.id} className={`hg-font-card ${options.font === font.id ? "is-selected" : ""}`} aria-pressed={options.font === font.id} aria-label={`Шрифт ${font.label}`} onClick={() => update({ font: font.id })}><span className="hg-font-sample" style={{ fontFamily: font.family, fontWeight: font.weight }}>Мир</span><span className="hg-font-name">{font.label}{options.font === font.id && <Check size={11} />}</span></button>)}
        </div>
      </section>

      <section className="hg-control-panel hg-colors-panel">
        <div className="hg-section-heading"><span className="hg-step">02</span><h2>Цвет и настроение</h2></div>
        <span className="hg-label">Быстрый стиль</span>
        <div className="hg-style-presets">{STYLES.map(style => <button key={style.name} aria-label={`Стиль ${style.name}`} onClick={() => update({ color: style.color, endColor: style.endColor, gradient: style.gradient, depth: style.depth, outlineWidth: style.outlineWidth })}><span style={{ background: `linear-gradient(135deg,${style.color},${style.endColor})` }} />{style.name}</button>)}</div>
        <div className="hg-palette-heading"><span className="hg-label">Цвет текста</span><span>Любой оттенок — твой выбор</span></div>
        <div className="hg-color-swatches" role="group" aria-label="Палитра текста">{COLORS.map(color => <button key={color} aria-label={`Цвет текста ${color}`} aria-pressed={options.color.toLowerCase() === color} style={{ background: color }} className={options.color.toLowerCase() === color ? "is-selected" : ""} onClick={() => update({ color })}>{options.color.toLowerCase() === color && <Check size={13} style={{ color: ["#111114", "#9254e8"].includes(color) ? "white" : "#1a1123" }} />}</button>)}</div>
        <ColorField id="hg-color" label="Свой цвет текста" value={options.color} onChange={color => update({ color })} />
        <label className="hg-switch-row"><span>Градиент<small>Плавный переход между двумя цветами</small></span><input type="checkbox" aria-label="Градиент текста" checked={options.gradient} onChange={event => update({ gradient: event.target.checked })} /><span className={`hg-switch ${options.gradient ? "is-on" : ""}`} aria-hidden="true"><span /></span></label>
        {options.gradient && <ColorField id="hg-end-color" label="Второй цвет" value={options.endColor} onChange={endColor => update({ endColor })} />}
        <label className="hg-checkbox"><input type="checkbox" aria-label="Прозрачный фон" checked={options.transparent} onChange={event => update({ transparent: event.target.checked })} /><span>Прозрачный фон</span><span className="hg-tiny-checker" aria-hidden="true" /></label>
        {!options.transparent && <ColorField id="hg-background" label="Цвет фона" value={options.background} onChange={background => update({ background })} />}
      </section>
    </div>

    <section className={`hg-effects-panel ${effectsOpen ? "is-open" : ""}`}>
      <button className="hg-effects-toggle" aria-expanded={effectsOpen} aria-controls="hg-effects" onClick={() => setEffectsOpen(value => !value)}><span><SlidersHorizontal size={16} />Настроить детали<small>Объём, обводка и расстояние между буквами</small></span><ChevronDown size={15} /></button>
      <div id="hg-effects" className="hg-effects-content" hidden={!effectsOpen}>
        <div className="hg-effects-ranges"><RangeField label="Объём" value={options.depth} min={0} max={12} onChange={depth => update({ depth })} /><RangeField label="Толщина обводки" value={options.outlineWidth} min={0} max={6} onChange={outlineWidth => update({ outlineWidth })} /><RangeField label="Размер надписи" value={options.size} min={50} max={150} suffix="%" onChange={size => update({ size })} /><RangeField label="Расстояние между буквами" value={options.letterSpacing} min={0} max={6} onChange={letterSpacing => update({ letterSpacing })} /></div>
        <ColorField id="hg-outline-color" label="Цвет обводки" value={options.outlineColor} onChange={outlineColor => update({ outlineColor })} />
      </div>
    </section>

    <footer className="hg-export-bar"><span className="hg-export-hint"><Sparkles size={15} /><span>Твоя надпись. Без водяных знаков.<small>PNG в полном разрешении — с фоном или без.</small></span></span><div className="hg-export-actions"><button className="hg-button" disabled={!hasText || Boolean(busy) || Boolean(error)} onClick={() => void perform("copy")}>{busy === "copy" ? <LoaderCircle size={15} className="animate-spin" /> : <Copy size={15} />}<span>Скопировать PNG</span></button><button className="hg-button hg-primary" disabled={!hasText || Boolean(busy) || Boolean(error)} onClick={() => void perform("download")}>{busy === "download" ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}<span>Скачать заголовок</span></button></div></footer>
  </div>;
}
