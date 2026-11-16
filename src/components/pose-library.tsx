"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Box, Check, ChevronDown, Expand, LoaderCircle, RotateCcw, Search, SlidersHorizontal, Sparkles, Star, X } from "lucide-react";
import MinecraftScene, { type MinecraftSceneHandle } from "./minecraft-scene";
import PosePreview from "./pose-preview";
import { PRESETS, presetScene, type PosePreset } from "@/lib/pose-presets";
import "./pose-library.css";

type Props = {
  skin: string;
  slim: boolean;
  onOpen: (presetId: string) => void;
  onNotify?: (message: string) => void;
  onSlimChange?: (slim: boolean) => void;
};

const FAVORITES_KEY = "minepose-pose-favorites-v1";
const categories = [...new Set(PRESETS.map(preset => preset.category))];
const normalize = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е");

function readFavorites(value: string | null) {
  const data: unknown = value ? JSON.parse(value) : [];
  if (!Array.isArray(data)) throw new Error("Некорректный список избранных поз");
  return data.filter((id): id is string => typeof id === "string" && PRESETS.some(preset => preset.id === id));
}

function QuickPoseModal({ preset, skin, slim, onClose, onOpen }: { preset: PosePreset; skin: string; slim: boolean; onClose: () => void; onOpen: () => void }) {
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sceneRef = useRef<MinecraftSceneHandle>(null);
  const [skinReady, setSkinReady] = useState(false);
  const [itemsReady, setItemsReady] = useState(false);
  const [error, setError] = useState("");
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex='0']") || []);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    window.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = overflow; window.removeEventListener("keydown", keyboard); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const number = String(PRESETS.findIndex(item => item.id === preset.id) + 1).padStart(2, "0");
  return createPortal(<div className="pl-quick-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={modalRef} className="pl-quick-dialog" role="dialog" aria-modal="true" aria-labelledby="pl-quick-title">
      <header className="pl-quick-heading"><div><span className="pl-quick-category">{preset.category}<i />ШАБЛОН {number}</span><h2 id="pl-quick-title">{preset.name}</h2></div><button ref={closeRef} className="pl-icon-button" onClick={onClose} aria-label="Закрыть быстрый просмотр"><X size={19} /></button></header>
      <div className="pl-quick-stage">
        <MinecraftScene ref={sceneRef} pose={preset.pose} settings={presetScene(preset, skin, slim)} autoFrame interactive className="pl-quick-scene" onReady={setSkinReady} onItemsReady={(ready, message) => { setItemsReady(ready); setError(message || ""); }} />
        {(!skinReady || !itemsReady) && !error && <span className="pl-quick-loading" role="status"><LoaderCircle size={14} />Загружаем 3D-позу</span>}
        {error && <span className="pl-quick-error" role="alert">{error}</span>}
        <div className="pl-quick-stage-footer"><span><Box size={13} />Тяни для вращения · Колесо для масштаба</span><button className="pl-icon-button" aria-label="Сбросить ракурс позы" title="Сбросить ракурс" onClick={() => sceneRef.current?.resetCamera()}><RotateCcw size={15} /></button></div>
      </div>
      <footer className="pl-quick-footer"><div><p>{preset.description}</p><span>Скин и предметы откроются вместе с позой. Все настройки можно изменить.</span></div><button className="pl-open-button pl-open-primary" aria-label={`Открыть позу в редакторе: ${preset.name}`} onClick={onOpen}>Открыть позу<ArrowRight size={16} /></button></footer>
    </section>
  </div>, document.body);
}

export default function PoseLibrary({ skin, slim, onOpen, onNotify, onSlimChange }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("default");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [localSlim, setLocalSlim] = useState(slim);
  const [quickPreset, setQuickPreset] = useState<PosePreset | null>(null);
  const notify = useRef(onNotify);
  notify.current = onNotify;
  const activeSlim = onSlimChange ? slim : localSlim;
  useEffect(() => { setLocalSlim(slim); }, [slim]);
  useEffect(() => {
    try { setFavorites(readFavorites(localStorage.getItem(FAVORITES_KEY))); }
    catch { notify.current?.("Не удалось прочитать избранные позы в этом браузере."); }
    setFavoritesLoaded(true);
    function sync(event: StorageEvent) {
      if (event.key !== FAVORITES_KEY) return;
      try { setFavorites(readFavorites(event.newValue)); }
      catch { notify.current?.("Не удалось обновить избранные позы."); }
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const filtered = useMemo(() => {
    const words = normalize(query.trim()).split(/\s+/).filter(Boolean);
    const result = PRESETS.filter(preset => (category === "all" || preset.category === category) && (!favoritesOnly || favorites.includes(preset.id)) && words.every(word => normalize(`${preset.name} ${preset.category} ${preset.description}`).includes(word)));
    if (sort === "name") return result.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    if (sort === "category") return result.sort((a, b) => a.category.localeCompare(b.category, "ru") || a.name.localeCompare(b.name, "ru"));
    return result;
  }, [query, category, sort, favorites, favoritesOnly]);
  const closeQuick = useCallback(() => setQuickPreset(null), []);
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id];
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); setFavorites(next); }
    catch { notify.current?.("Браузер не разрешил сохранить избранное. Проверь настройки хранения данных."); }
  }
  function changeModel(value: boolean) { onSlimChange ? onSlimChange(value) : setLocalSlim(value); }
  function clearFilters() { setQuery(""); setCategory("all"); setFavoritesOnly(false); setSort("default"); }
  const hasFilters = Boolean(query || category !== "all" || favoritesOnly);
  return <section className="pl-library" aria-labelledby="pl-library-title">
    <div className="pl-heading"><div><span className="pl-eyebrow"><Sparkles size={13} />БИБЛИОТЕКА ПОЗ</span><h2 id="pl-library-title" tabIndex={-1}>Готовые позы</h2><p>Найди настроение. Добавь свой скин. Продолжи в редакторе.</p></div><div className="pl-heading-controls"><span className="pl-total">12 ШАБЛОНОВ</span><div className="pl-model-toggle" role="group" aria-label="Модель персонажа в готовых позах"><button className={!activeSlim ? "is-active" : ""} aria-label="Модель Classic" aria-pressed={!activeSlim} onClick={() => changeModel(false)}>{!activeSlim && <Check size={11} />}Classic</button><button className={activeSlim ? "is-active" : ""} aria-label="Модель Slim" aria-pressed={activeSlim} onClick={() => changeModel(true)}>{activeSlim && <Check size={11} />}Slim</button></div></div></div>
    <div className="pl-toolbar">
      <div className="pl-search"><Search size={16} /><input type="search" aria-label="Поиск готовых поз" placeholder="Название или настроение позы…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="pl-clear-search" aria-label="Очистить поиск готовых поз" onClick={() => setQuery("")}><X size={14} /></button>}</div>
      <div className="pl-select-wrap"><select aria-label="Категория готовых поз" value={category} onChange={event => setCategory(event.target.value)}><option value="all">Все категории</option>{categories.map(value => <option value={value} key={value}>{value}</option>)}</select><ChevronDown size={13} /></div>
      <div className="pl-select-wrap pl-sort"><SlidersHorizontal size={14} /><select aria-label="Сортировка готовых поз" value={sort} onChange={event => setSort(event.target.value)}><option value="default">По порядку</option><option value="name">По названию</option><option value="category">По категории</option></select><ChevronDown size={13} /></div>
      <button className={`pl-favorites-filter ${favoritesOnly ? "is-active" : ""}`} aria-label="Только избранные позы" aria-pressed={favoritesOnly} disabled={!favoritesLoaded} onClick={() => setFavoritesOnly(value => !value)}><Star size={15} fill={favoritesOnly ? "currentColor" : "none"} /><span>Избранное</span><small>{favorites.length}</small></button>
    </div>
    {hasFilters && <div className="pl-filter-summary" role="status"><span>Найдено: <strong>{filtered.length}</strong> из {PRESETS.length}</span><button onClick={clearFilters}>Сбросить фильтры<X size={11} /></button></div>}
    {filtered.length ? <div className="pl-grid">{filtered.map(preset => {
      const favorite = favorites.includes(preset.id);
      const number = String(PRESETS.findIndex(value => value.id === preset.id) + 1).padStart(2, "0");
      return <article className="pl-card" key={preset.id} data-preset={preset.id}>
        <div className="pl-card-visual"><button className="pl-card-preview" aria-label={`Быстрый просмотр: ${preset.name}`} onClick={() => setQuickPreset(preset)}><PosePreview preset={preset} skin={skin} slim={activeSlim} className="pl-preview-scene" /><span className="pl-preview-cue"><Expand size={13} />Рассмотреть</span></button><div className="pl-card-meta"><span className="pl-card-category">{preset.category}</span><span className="pl-card-number">{number}</span></div><button className={`pl-favorite-button ${favorite ? "is-active" : ""}`} disabled={!favoritesLoaded} aria-label={`${favorite ? "Убрать из избранного" : "Добавить в избранное"}: ${preset.name}`} aria-pressed={favorite} title={favorite ? "Убрать из избранного" : "В избранное"} onClick={() => toggleFavorite(preset.id)}><Star size={15} fill={favorite ? "currentColor" : "none"} /></button></div>
        <div className="pl-card-copy"><h3>{preset.name}</h3><p>{preset.description}</p><button className="pl-open-button" aria-label={`Открыть позу: ${preset.name}`} onClick={() => onOpen(preset.id)}>Открыть позу<ArrowRight size={14} /></button></div>
      </article>;
    })}</div> : <div className="pl-empty"><span>{favoritesOnly ? <Star size={25} /> : <Search size={25} />}</span><h3>{favoritesOnly && !favorites.length ? "Собери свою коллекцию" : "Подходящих поз пока нет"}</h3><p>{favoritesOnly && !favorites.length ? "Отмечай любимые позы звёздочкой — они будут ждать тебя здесь." : "Попробуй другое название или выбери все категории."}</p><button onClick={clearFilters}>Показать все позы<ArrowRight size={14} /></button></div>}
    {quickPreset && <QuickPoseModal preset={quickPreset} skin={skin} slim={activeSlim} onClose={closeQuick} onOpen={() => { setQuickPreset(null); onOpen(quickPreset.id); }} />}
  </section>;
}
