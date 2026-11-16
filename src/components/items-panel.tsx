"use client";

import { useMemo, useRef, useState } from "react";
import { Box, Check, ChevronDown, Hand, PackageOpen, RotateCcw, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ITEM_CATALOG, ITEM_CATEGORIES, getItemDefinition, makeEquippedItem, type EquippedItems, type Hand as ItemHand, type ItemTransform } from "@/lib/items";
import ItemPreview, { ItemIcon } from "./item-preview";
import "./items-panel.css";

type Props = {
  items: EquippedItems;
  onChange: (items: EquippedItems) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
};
type Axis = "x" | "y" | "z";
const AXES: Axis[] = ["x", "y", "z"];
const handNames: Record<ItemHand, string> = { right: "Правая рука", left: "Левая рука" };
const handGenitive: Record<ItemHand, string> = { right: "правой руки", left: "левой руки" };
const handForSettings: Record<ItemHand, string> = { right: "Правая", left: "Левая" };

export default function ItemsPanel({ items, onChange, onGestureStart, onGestureEnd }: Props) {
  const [hand, setHand] = useState<ItemHand>("right");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [transformOpen, setTransformOpen] = useState(true);
  const catalogRef = useRef<HTMLDivElement>(null);
  const selected = items[hand];
  const definition = selected ? getItemDefinition(selected.id) : undefined;
  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase("ru").replace(/ё/g, "е").split(/\s+/).filter(Boolean);
    return ITEM_CATALOG.filter(item => {
      if (category !== "all" && item.category !== category) return false;
      const text = `${item.name} ${item.id} ${item.id.replaceAll("_", " ")} ${(item.keywords || []).join(" ")}`.toLocaleLowerCase("ru").replace(/ё/g, "е");
      return words.every(word => text.includes(word));
    });
  }, [query, category]);

  function replace(id: string) {
    onGestureEnd?.();
    if (items[hand]?.id === id) return;
    onChange({ ...items, [hand]: makeEquippedItem(id) });
  }
  function patchTransform(change: Partial<ItemTransform>) {
    if (!selected) return;
    onChange({ ...items, [hand]: { ...selected, transform: { ...selected.transform, ...change } } });
  }
  function axisChange(group: "position" | "rotation", axis: Axis, raw: string) {
    const number = Number(raw);
    if (!Number.isFinite(number) || !selected) return;
    const limit = group === "position" ? 2 : 180;
    patchTransform({ [group]: { ...selected.transform[group], [axis]: Math.max(-limit, Math.min(limit, number)) } });
  }
  function remove() {
    onGestureEnd?.();
    onChange({ ...items, [hand]: null });
  }
  function reset() {
    if (!selected) return;
    onGestureEnd?.();
    onChange({ ...items, [hand]: makeEquippedItem(selected.id) });
  }
  function beginGesture() { onGestureStart?.(); }
  function finishGesture() { onGestureEnd?.(); }
  function changeHand(next: ItemHand) { finishGesture(); setHand(next); }
  function filterCategory(value: string) { setCategory(value); catalogRef.current?.scrollTo({ top: 0 }); }

  return <div className="ip-panel">
    <section className="ip-hand-section" aria-label="Выбор руки для предмета">
      <div className="ip-heading"><span><Hand size={14} />Предмет в руке</span><small>2 СЛОТА</small></div>
      <div className="ip-hands" role="group" aria-label="Рука персонажа">
        {(["right", "left"] as ItemHand[]).map(value => <button key={value} className={`ip-hand ${hand === value ? "is-active" : ""}`} aria-label={handNames[value]} aria-pressed={hand === value} onClick={() => changeHand(value)}>
          <span className="ip-hand-art">{items[value] ? <ItemIcon id={items[value]!.id} /> : <Hand size={18} className={value === "left" ? "ip-left-hand" : ""} />}</span>
          <span><strong>{handNames[value]}</strong><small>{items[value] ? getItemDefinition(items[value]!.id)?.name || items[value]!.id : "Пусто"}</small></span>
          {hand === value && <span className="ip-hand-dot" />}
        </button>)}
      </div>
    </section>

    <section className="ip-catalog-section" aria-label="Каталог предметов Minecraft">
      <div className="ip-heading"><span><Box size={14} />Каталог предметов</span><small>{ITEM_CATALOG.length}</small></div>
      <div className="ip-search"><Search size={14} /><input type="search" aria-label="Поиск предметов" placeholder="Найти предмет…" value={query} onChange={event => { setQuery(event.target.value); catalogRef.current?.scrollTo({ top: 0 }); }} />{query && <button aria-label="Очистить поиск предметов" title="Очистить поиск" onClick={() => setQuery("")}><X size={13} /></button>}</div>
      <div className="ip-category"><select aria-label="Категория предметов" value={category} onChange={event => filterCategory(event.target.value)}><option value="all">Все категории</option>{ITEM_CATEGORIES.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><ChevronDown size={13} /></div>
      <div className="ip-catalog-summary"><span>{query || category !== "all" ? "Найдено" : "Выбери предмет"}<strong>{filtered.length}</strong></span><span>В {hand === "right" ? "правую" : "левую"} руку</span></div>
      <div className="ip-catalog" ref={catalogRef}>
        {filtered.length ? <div className="ip-item-grid">{filtered.map(item => <button key={item.id} className={`ip-item ${selected?.id === item.id ? "is-selected" : ""}`} title={`${item.name} · ${item.id}`} aria-label={`Взять: ${item.name}`} aria-pressed={selected?.id === item.id} onClick={() => replace(item.id)}>
          <span className="ip-item-art"><ItemIcon id={item.id} />{selected?.id === item.id && <Check size={11} className="ip-item-check" />}</span><span className="ip-item-name">{item.name}</span>
        </button>)}</div> : <div className="ip-no-results"><Search size={22} /><strong>Ничего не найдено</strong><p>Попробуй другое название<br />или выбери все категории.</p><button onClick={() => { setQuery(""); filterCategory("all"); }}>Сбросить поиск</button></div>}
      </div>
    </section>

    {selected && definition ? <>
      <section className="ip-selected-section" aria-label={`Предмет: ${definition.name}`}>
        <div className="ip-selected-heading"><div><span className="ip-eyebrow">{handNames[hand]}</span><h3>{definition.name}</h3></div><button className="ip-icon-button ip-remove" onClick={remove} aria-label={`Убрать предмет из ${handGenitive[hand]}`} title="Убрать предмет"><Trash2 size={15} /></button></div>
        <div className="ip-preview-frame"><ItemPreview id={selected.id} className="ip-preview-scene" /><span className="ip-preview-label">3D-ПРЕДПРОСМОТР</span></div>
        <div className="ip-preview-caption"><span />Перетаскивай, чтобы рассмотреть</div>
      </section>
      <section className="ip-transform-section">
        <button className="ip-transform-disclosure" onClick={() => setTransformOpen(value => !value)} aria-expanded={transformOpen} aria-controls="ip-transform-fields"><span><SlidersHorizontal size={14} />Положение предмета</span><ChevronDown size={14} /></button>
        {transformOpen && <div className="ip-transform-fields" id="ip-transform-fields">
          {(["position", "rotation"] as const).map(group => <fieldset className="ip-axis-fieldset" key={group}><legend>{group === "position" ? "Смещение" : "Вращение"}<span>{group === "position" ? "блока" : "градусы"}</span></legend>{AXES.map(axis => <div className={`ip-axis-row ip-axis-${axis}`} key={axis}><label htmlFor={`ip-${hand}-${group}-${axis}`}>{axis.toUpperCase()}</label><input type="range" aria-label={`${handForSettings[hand]} рука: ${group === "position" ? "смещение" : "вращение"} ${axis.toUpperCase()}`} min={group === "position" ? -2 : -180} max={group === "position" ? 2 : 180} step={group === "position" ? .025 : 1} value={selected.transform[group][axis]} onPointerDown={beginGesture} onPointerUp={finishGesture} onPointerCancel={finishGesture} onKeyDown={beginGesture} onKeyUp={finishGesture} onBlur={finishGesture} onChange={event => axisChange(group, axis, event.target.value)} /><input id={`ip-${hand}-${group}-${axis}`} aria-label={`${handForSettings[hand]} рука: ${group === "position" ? "координата" : "угол"} ${axis.toUpperCase()}`} type="number" min={group === "position" ? -2 : -180} max={group === "position" ? 2 : 180} step={group === "position" ? .025 : 1} value={Number(selected.transform[group][axis].toFixed(3))} onFocus={beginGesture} onBlur={finishGesture} onChange={event => axisChange(group, axis, event.target.value)} /></div>)}</fieldset>)}
          <div className="ip-scale-heading"><label htmlFor="ip-scale">Масштаб</label><output>{Math.round(selected.transform.scale * 100)}%</output></div>
          <div className="ip-scale-row"><input type="range" id="ip-scale" aria-label={`${handForSettings[hand]} рука: масштаб`} min={.25} max={3} step={.05} value={selected.transform.scale} onPointerDown={beginGesture} onPointerUp={finishGesture} onPointerCancel={finishGesture} onKeyDown={beginGesture} onKeyUp={finishGesture} onBlur={finishGesture} onChange={event => patchTransform({ scale: Number(event.target.value) })} /><input type="number" aria-label={`${handForSettings[hand]} рука: значение масштаба`} min={.25} max={3} step={.05} value={Number(selected.transform.scale.toFixed(2))} onFocus={beginGesture} onBlur={finishGesture} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value)) patchTransform({ scale: Math.max(.25, Math.min(3, value)) }); }} /><span>×</span></div>
          <button className="ip-reset" onClick={reset} aria-label={`Сбросить положение предмета в ${hand === "right" ? "правой" : "левой"} руке`}><RotateCcw size={12} />Стандартное положение</button>
          <p className="ip-attachment-note">Предмет закреплён в ладони и повторяет движения руки.</p>
        </div>}
      </section>
    </> : <section className="ip-empty-hand"><PackageOpen size={27} /><h3>{handNames[hand]} свободна</h3><p>Выбери предмет в каталоге.<br />У каждой руки свои настройки.</p></section>}
  </div>;
}
