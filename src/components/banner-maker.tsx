"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Copy, Dice5, Download, FileJson, Flag, Layers3, LoaderCircle, Moon, Plus, Redo2, RotateCcw, Sun, Trash2, Undo2, Upload } from "lucide-react";
import { DYES, MAX_BANNER_LAYERS, type BannerDesign, type BannerLayer, type DyeId } from "@/lib/banners";
import { BANNER_PATTERNS, BANNER_PRESETS, DEFAULT_BANNER } from "@/lib/banner-patterns";
import { bannerCommand, parseBannerDesign, renderBanner } from "@/lib/banner-renderer";
import { downloadDataUrl, downloadJson } from "@/lib/files";
import "./banner-maker.css";

type Props = { onNotify: (message: string) => void };
const STORAGE_KEY = "minepose-banner-v1";
const clone = (value: BannerDesign): BannerDesign => structuredClone(value);
const labelFor = (id: string) => BANNER_PATTERNS.find(pattern => pattern.id === id)?.label || id;
const dyeFor = (id: DyeId) => DYES.find(dye => dye.id === id)!;

function randomBanner(previous: BannerDesign): BannerDesign {
  const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
  const brightness = (hex: string) => {
    const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => parseInt(channel, 16) / 255);
    return r * .2126 + g * .7152 + b * .0722;
  };
  const base = pick(DYES.filter(dye => dye.id !== previous.base));
  const primary = pick(DYES.filter(dye => Math.abs(brightness(dye.hex) - brightness(base.hex)) > .3));
  const secondary = pick(DYES.filter(dye => dye.id !== base.id && dye.id !== primary.id));
  const pool = BANNER_PATTERNS.filter(pattern => pattern.category !== "icons" && !["border", "curly_border", "circle", "rhombus"].includes(pattern.id));
  const layers: BannerLayer[] = [];
  const backgroundLayers = 1 + Math.floor(Math.random() * 3);
  for (let index = 0; index < backgroundLayers; index++) {
    const [pattern] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    layers.push({ id: crypto.randomUUID(), pattern: pattern.id, color: index % 2 ? secondary.id : primary.id });
  }
  const emblem = pick(BANNER_PATTERNS.filter(pattern => pattern.category === "icons" || ["circle", "rhombus"].includes(pattern.id)));
  layers.push({ id: crypto.randomUUID(), pattern: emblem.id, color: backgroundLayers % 2 ? secondary.id : primary.id });
  if (Math.random() < .65) layers.push({ id: crypto.randomUUID(), pattern: pick(["border", "curly_border"]), color: primary.id });
  return { base: base.id, layers };
}

function BannerCanvas({ design, className = "", width = 80, label }: { design: BannerDesign; className?: string; width?: number; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    const output = document.createElement("canvas");
    void renderBanner(output, design, width).then(() => {
      if (!current || !canvas.current) return;
      canvas.current.width = output.width; canvas.current.height = output.height;
      canvas.current.getContext("2d")?.drawImage(output, 0, 0);
      setFailed(false);
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [design, width]);
  return <span className={`bm-canvas-wrap ${className}`}><canvas ref={canvas} width={width} height={width * 2} role={label ? "img" : undefined} aria-label={label} aria-hidden={!label} />{failed && <span className="bm-mini-error">?</span>}</span>;
}

function DyePalette({ value, onChange, label }: { value: DyeId; onChange: (id: DyeId) => void; label: string }) {
  return <div className="bm-dye-palette" role="group" aria-label={label}>{DYES.map(dye => <button key={dye.id} type="button" className={value === dye.id ? "is-selected" : ""} aria-label={`${label}: ${dye.label}`} aria-pressed={value === dye.id} title={dye.label} style={{ background: dye.hex }} onClick={() => onChange(dye.id)}>{value === dye.id && <Check size={14} style={{ color: ["black", "gray", "purple", "blue", "brown", "green", "red"].includes(dye.id) ? "#ffffff" : "#18131e" }} />}</button>)}</div>;
}

export default function BannerMaker({ onNotify }: Props) {
  const [design, setDesign] = useState<BannerDesign>(() => clone(DEFAULT_BANNER));
  const designRef = useRef(design); designRef.current = design;
  const [selectedId, setSelectedId] = useState<string | null>(() => DEFAULT_BANNER.layers.at(-1)?.id || null);
  const [category, setCategory] = useState<"stripes" | "shapes" | "icons">("shapes");
  const [patternColor, setPatternColor] = useState<DyeId>("white");
  const [lightPreview, setLightPreview] = useState(false);
  const [past, setPast] = useState<BannerDesign[]>([]);
  const [future, setFuture] = useState<BannerDesign[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const storageBlockedRef = useRef(false);
  const [rendering, setRendering] = useState(true);
  const [renderError, setRenderError] = useState("");
  const [busy, setBusy] = useState<"png" | "copy" | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const commandInput = useRef<HTMLTextAreaElement>(null);
  const revision = useRef(0);
  const notifyRef = useRef(onNotify); notifyRef.current = onNotify;
  const selected = design.layers.find(layer => layer.id === selectedId);
  const color = selected?.color || patternColor;
  const command = bannerCommand(design);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) { const restored = parseBannerDesign(JSON.parse(saved)); designRef.current = restored; setDesign(restored); setSelectedId(restored.layers.at(-1)?.id || null); }
    } catch {
      storageBlockedRef.current = true; setStorageBlocked(true);
      notifyRef.current("Не удалось восстановить сохранённый флаг. Исходные данные не изменены.");
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded || storageBlockedRef.current) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(design)); }
    catch { storageBlockedRef.current = true; setStorageBlocked(true); notifyRef.current("Браузер не сохранил флаг. Скачайте JSON, чтобы не потерять узор."); }
  }, [design, loaded]);
  useEffect(() => {
    const current = ++revision.current; setRendering(true); setRenderError("");
    const output = document.createElement("canvas");
    void renderBanner(output, design).then(() => {
      if (current !== revision.current || !preview.current) return;
      preview.current.width = output.width; preview.current.height = output.height;
      preview.current.getContext("2d")?.drawImage(output, 0, 0);
    }).catch(error => {
      if (current !== revision.current) return;
      const message = error instanceof Error ? error.message : "Не удалось загрузить узоры флага";
      setRenderError(message); notifyRef.current(message);
    }).finally(() => { if (current === revision.current) setRendering(false); });
    return () => { if (current === revision.current) revision.current++; };
  }, [design]);

  function replace(next: BannerDesign) { designRef.current = next; setDesign(next); }
  function update(change: (previous: BannerDesign) => BannerDesign) {
    const previous = designRef.current, next = change(clone(previous));
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    setPast(history => [...history.slice(-39), clone(previous)]); setFuture([]); replace(next);
  }
  function apply(next: BannerDesign) { update(() => clone(next)); setSelectedId(next.layers.at(-1)?.id || null); }
  function randomize() {
    const next = randomBanner(designRef.current);
    apply(next);
    const top = next.layers.at(-1)!;
    setPatternColor(top.color);
    setCategory(BANNER_PATTERNS.find(pattern => pattern.id === top.pattern)!.category);
  }
  function undo() {
    const previous = past.at(-1); if (!previous) return;
    const current = clone(designRef.current);
    setFuture(history => [...history, current]); setPast(history => history.slice(0, -1)); replace(previous);
    setSelectedId(previous.layers.at(-1)?.id || null);
  }
  function redo() {
    const next = future.at(-1); if (!next) return;
    const current = clone(designRef.current);
    setPast(history => [...history, current]); setFuture(history => history.slice(0, -1)); replace(next);
    setSelectedId(next.layers.at(-1)?.id || null);
  }
  function addLayer(pattern = "border") {
    if (designRef.current.layers.length >= MAX_BANNER_LAYERS) { onNotify("На флаге уже шесть узоров. Удали слой или замени выбранный."); return; }
    const layer: BannerLayer = { id: crypto.randomUUID(), pattern, color: patternColor };
    update(previous => ({ ...previous, layers: [...previous.layers, layer] })); setSelectedId(layer.id);
  }
  function choosePattern(pattern: string) {
    if (!selected) { addLayer(pattern); return; }
    update(previous => ({ ...previous, layers: previous.layers.map(layer => layer.id === selectedId ? { ...layer, pattern } : layer) }));
  }
  function chooseColor(next: DyeId) {
    setPatternColor(next);
    if (selected) update(previous => ({ ...previous, layers: previous.layers.map(layer => layer.id === selectedId ? { ...layer, color: next } : layer) }));
  }
  function removeLayer(id: string) {
    update(previous => ({ ...previous, layers: previous.layers.filter(layer => layer.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }
  function moveLayer(id: string, offset: number) {
    update(previous => {
      const index = previous.layers.findIndex(layer => layer.id === id), target = index + offset;
      if (index < 0 || target < 0 || target >= previous.layers.length) return previous;
      [previous.layers[index], previous.layers[target]] = [previous.layers[target], previous.layers[index]];
      return previous;
    });
  }
  async function exportPng() {
    setBusy("png");
    try { const output = document.createElement("canvas"); await renderBanner(output, designRef.current); downloadDataUrl(output.toDataURL("image/png"), "minepose-banner.png"); onNotify("Флаг 400 × 800 сохранён"); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Не удалось сохранить флаг"); }
    finally { setBusy(null); }
  }
  async function copyCommand() {
    setBusy("copy");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Буфер обмена недоступен. Выдели команду и скопируй вручную.");
      await navigator.clipboard.writeText(bannerCommand(designRef.current)); onNotify("Команда /give скопирована. Вставь её в Minecraft Java 1.21+.");
    } catch { commandInput.current?.focus(); commandInput.current?.select(); onNotify("Не удалось скопировать автоматически. Команда выделена — нажми Ctrl+C."); }
    finally { setBusy(null); }
  }
  async function importDesign(file?: File) {
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error("Выбери JSON-файл флага размером до 100 КБ");
      apply(parseBannerDesign(JSON.parse(await file.text()))); onNotify("Флаг импортирован");
    } catch (error) { onNotify(error instanceof Error ? error.message : "Не удалось открыть флаг"); }
    finally { if (input.current) input.current.value = ""; }
  }
  function recoverStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || "";
      const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
      downloadDataUrl(url, "minepose-banner-recovery.json"); setTimeout(() => URL.revokeObjectURL(url), 1000);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(designRef.current));
      storageBlockedRef.current = false; setStorageBlocked(false); onNotify("Копия исходных данных скачана. Сохранение флага восстановлено.");
    } catch { onNotify("Браузер блокирует хранилище. Используй экспорт JSON."); }
  }

  return <div className="bm-maker">
    <div className="bm-intro"><p>Создай свой флаг из <strong>16 красителей</strong> и <strong>{BANNER_PATTERNS.length} узоров Minecraft</strong>. Накладывай слои, меняй цвета и забирай результат в игру.</p><span>JAVA 1.21+</span></div>
    {storageBlocked && <div className="bm-storage-notice"><span>Автосохранение недоступно. Исходные данные сохранены без изменений.</span><button onClick={recoverStorage}>Скачать копию и восстановить</button></div>}
    <div className="bm-workspace">
      <div className="bm-preview-column">
        <div className={`bm-preview-stage ${lightPreview ? "is-light" : ""}`}>
          <div className="bm-stage-toolbar"><span className="bm-eyebrow"><Flag size={13} />ТВОЙ ФЛАГ</span><div className="bm-preview-themes"><button aria-label="Тёмный фон предпросмотра флага" aria-pressed={!lightPreview} className={!lightPreview ? "is-active" : ""} onClick={() => setLightPreview(false)}><Moon size={14} /></button><button aria-label="Светлый фон предпросмотра флага" aria-pressed={lightPreview} className={lightPreview ? "is-active" : ""} onClick={() => setLightPreview(true)}><Sun size={14} /></button></div></div>
          <div className="bm-banner-display"><span className="bm-pole" aria-hidden="true" /><canvas ref={preview} width={400} height={800} className="bm-banner-canvas" role="img" aria-label="Предпросмотр флага Minecraft" />{renderError && <div className="bm-render-error" role="alert">{renderError}</div>}</div>
          <div className="bm-stage-footer"><span>{rendering ? <><LoaderCircle size={12} className="animate-spin" />Загружаем узоры…</> : <>{design.layers.length} / 6 слоёв · 20 × 40 пикселей</>}</span><div className="bm-preview-controls"><button className="bm-random" aria-label="Случайный флаг" title="Рандом — создать случайный флаг" disabled={!loaded || Boolean(busy)} onClick={randomize}><Dice5 size={16} /></button><div className="bm-history"><button aria-label="Отменить изменение флага" title="Отменить" disabled={!past.length} onClick={undo}><Undo2 size={15} /></button><button aria-label="Повторить изменение флага" title="Повторить" disabled={!future.length} onClick={redo}><Redo2 size={15} /></button><span /><button aria-label="Сбросить флаг" title="Начать со стандартного флага" onClick={() => apply(DEFAULT_BANNER)}><RotateCcw size={15} /></button></div></div></div>
        </div>
        <div className="bm-export-actions"><button className="bm-button bm-primary" disabled={Boolean(busy) || Boolean(renderError)} onClick={() => void exportPng()}>{busy === "png" ? <LoaderCircle size={15} className="animate-spin" /> : <Download size={15} />}Скачать флаг PNG</button><button className="bm-button" disabled={Boolean(busy)} onClick={() => void copyCommand()}>{busy === "copy" ? <LoaderCircle size={15} className="animate-spin" /> : <Copy size={15} />}Скопировать /give</button></div>
        <div className="bm-command"><label htmlFor="bm-command">Твой флаг в Minecraft Java 1.21+</label><textarea ref={commandInput} id="bm-command" aria-label="Команда выдачи флага" value={command} readOnly spellCheck={false} onClick={event => event.currentTarget.select()} /><small>Вставь команду в чат с разрешёнными командами. PNG скачивается без подставки и фона.</small></div>
        <div className="bm-file-actions"><button onClick={() => downloadJson(designRef.current, "minepose-banner.json")}><FileJson size={13} />Скачать проект JSON</button><button onClick={() => input.current?.click()}><Upload size={13} />Открыть JSON</button></div>
      </div>

      <div className="bm-controls-column">
        <section className="bm-panel">
          <div className="bm-section-heading"><span className="bm-step">01</span><h2>Основа флага</h2><span className="bm-selected-dye"><i style={{ background: dyeFor(design.base).hex }} />{dyeFor(design.base).label}</span></div>
          <DyePalette label="Цвет основы" value={design.base} onChange={base => update(previous => ({ ...previous, base }))} />
          <div className="bm-presets"><span>Или начни с готового</span><div>{BANNER_PRESETS.map(preset => <button key={preset.id} onClick={() => apply(preset.design)}>{preset.label}</button>)}</div></div>
        </section>

        <section className="bm-panel bm-layer-panel">
          <div className="bm-section-heading"><span className="bm-step">02</span><h2>Слои узора</h2><span className="bm-layer-count">{design.layers.length} / {MAX_BANNER_LAYERS}</span><button className="bm-add-layer" onClick={() => addLayer()} disabled={design.layers.length >= MAX_BANNER_LAYERS}><Plus size={13} />Добавить</button></div>
          <p className="bm-layer-explanation">Слой вверху списка перекрывает остальные.</p>
          <div className="bm-layer-list" aria-label="Слои флага">
            {design.layers.map((layer, index) => ({ layer, index })).reverse().map(({ layer, index }) => <div key={layer.id} className={`bm-layer-row ${selectedId === layer.id ? "is-selected" : ""}`}>
              <button className="bm-layer-select" aria-label={`Выбрать слой ${index + 1}: ${labelFor(layer.pattern)}`} aria-pressed={selectedId === layer.id} onClick={() => { setSelectedId(layer.id); setPatternColor(layer.color); }}><BannerCanvas design={{ base: design.base, layers: design.layers.slice(0, index + 1) }} width={30} className="bm-layer-mini" /><span><strong>{labelFor(layer.pattern)}</strong><small>{dyeFor(layer.color).label}</small></span></button>
              <div className="bm-layer-actions"><button aria-label={`Поднять слой ${index + 1}`} title="Поднять выше" disabled={index === design.layers.length - 1} onClick={() => moveLayer(layer.id, 1)}><ChevronUp size={15} /></button><button aria-label={`Опустить слой ${index + 1}`} title="Опустить ниже" disabled={index === 0} onClick={() => moveLayer(layer.id, -1)}><ChevronDown size={15} /></button><button aria-label={`Удалить слой ${index + 1}`} title="Удалить слой" onClick={() => removeLayer(layer.id)}><Trash2 size={14} /></button></div>
            </div>)}
            {!design.layers.length && <div className="bm-empty-layers"><Layers3 size={21} /><span>Чистый флаг — начало истории.<small>Выбери узор ниже, чтобы добавить первый слой.</small></span></div>}
            <button className={`bm-base-row ${selectedId === null ? "is-selected" : ""}`} onClick={() => setSelectedId(null)}><span style={{ background: dyeFor(design.base).hex }} /><span>Основа — {dyeFor(design.base).label.toLowerCase()}</span>{selectedId === null && <Check size={13} />}</button>
          </div>
          {design.layers.length >= MAX_BANNER_LAYERS && <p className="bm-limit-note">Все 6 слоёв заняты. Выбранный узор можно заменить или удалить.</p>}
        </section>

        <section className="bm-panel bm-pattern-panel">
          <div className="bm-section-heading"><span className="bm-step">03</span><h2>{selected ? "Настрой выбранный слой" : "Добавь новый узор"}</h2></div>
          <div className="bm-pattern-color-heading"><span>{selected ? labelFor(selected.pattern) : "Цвет следующего узора"}</span><span><i style={{ background: dyeFor(color).hex }} />{dyeFor(color).label}</span></div>
          <DyePalette label="Цвет узора" value={color} onChange={chooseColor} />
          <div className="bm-pattern-tabs" role="tablist" aria-label="Категории узоров">{([{ id: "stripes", label: "Полосы" }, { id: "shapes", label: "Фигуры" }, { id: "icons", label: "Символы" }] as const).map(tab => <button key={tab.id} role="tab" aria-selected={category === tab.id} className={category === tab.id ? "is-active" : ""} onClick={() => setCategory(tab.id)}>{tab.label}<span>{BANNER_PATTERNS.filter(pattern => pattern.category === tab.id).length}</span></button>)}</div>
          <div className="bm-pattern-grid" role="group" aria-label="Узоры флага">{BANNER_PATTERNS.filter(pattern => pattern.category === category).map(pattern => <button key={pattern.id} title={pattern.label} aria-label={`Узор: ${pattern.label}`} aria-pressed={selected?.pattern === pattern.id} className={selected?.pattern === pattern.id ? "is-selected" : ""} onClick={() => choosePattern(pattern.id)}><BannerCanvas design={{ base: design.base, layers: [{ id: "preview", pattern: pattern.id, color }] }} width={40} /><span>{pattern.label}</span>{selected?.pattern === pattern.id && <Check size={11} className="bm-pattern-check" />}</button>)}</div>
        </section>
      </div>
    </div>
    <input type="file" accept="application/json,.json" ref={input} hidden aria-label="Файл проекта флага" onChange={event => void importDesign(event.target.files?.[0])} />
  </div>;
}
