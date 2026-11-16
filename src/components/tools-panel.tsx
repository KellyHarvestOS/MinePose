"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, Circle, Download, Flag, Plus, Sparkles, Type, UserRound, WandSparkles } from "lucide-react";
import type { ToolId } from "@/lib/tools";
import { downloadDataUrl } from "@/lib/files";
import HeadingGenerator from "./heading-generator";
import BannerMaker from "./banner-maker";
import AvatarMaker from "./avatar-maker";
import "./tools-panel.css";

type Props = { onNotify: (message: string) => void; onCreatePose: () => void; activeTool: ToolId | null; onToolChange: (id: ToolId | null) => void };
type ToolProps = { onNotify: Props["onNotify"] };
const TOOLS: { id: ToolId; title: string; caption: string; description: string; tag: string; color: string; icon: typeof UserRound }[] = [
  { id: "avatar", title: "Создатель аватарок", caption: "Твой скин. Твой ракурс.", description: "Объёмная аватарка для профиля: выбери позу, фон и сохрани PNG.", tag: "3D · PNG", color: "#c395ff", icon: UserRound },
  { id: "heading", title: "Генератор заголовков", caption: "Скажи это крупнее.", description: "Minecraft-шрифты, любой цвет и объёмный текст для твоих проектов.", tag: "ТЕКСТ · PNG", color: "#e4bd6c", icon: Type },
  { id: "banner", title: "Мастерская флагов", caption: "Символ твоего мира.", description: "Собери флаг из узоров и красителей Minecraft. Сохрани PNG или команду.", tag: "УЗОРЫ · СЛОИ", color: "#71b9ce", icon: Flag },
  { id: "circle", title: "Пиксельные круги", caption: "Идеальная форма из блоков.", description: "Схема круга любого диаметра с подсчётом блоков для твоей постройки.", tag: "ПОСТРОЙКИ", color: "#b49adf", icon: Circle },
];
const PALETTE = ["#c395ff", "#9d79d6", "#58b8cd", "#dfad58", "#d97373", "#e8e7dd", "#372e3f", "#19151d"];

function Field({ title, children }: { title: string; children: ReactNode }) { return <div className="tp-field-group"><span className="tp-label">{title}</span>{children}</div>; }
function Swatches({ value, onChange, colors = PALETTE }: { value: string; onChange: (color: string) => void; colors?: string[] }) {
  return <div className="tp-swatches">{colors.map(color => <button key={color} title={color} aria-label={`Цвет ${color}`} className={value.toLowerCase() === color.toLowerCase() ? "is-selected" : ""} style={{ background: color }} onClick={() => onChange(color)}>{value.toLowerCase() === color.toLowerCase() && <Check size={13} />}</button>)}<label className="tp-color-picker" title="Свой цвет"><Plus size={15} /><input type="color" value={value === "transparent" ? "#c395ff" : value} aria-label="Выбрать свой цвет" onChange={event => onChange(event.target.value)} /></label></div>;
}
function CheckField({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) { return <label className="tp-check"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} /><span>{children}</span></label>; }

function circlePixels(diameter: number, filled: boolean) {
  const pixels: [number, number][] = []; const radius = diameter / 2;
  for (let y = 0; y < diameter; y++) for (let x = 0; x < diameter; x++) { const distance = Math.hypot(x + .5 - radius, y + .5 - radius); if (distance <= radius && (filled || distance > radius - 1.15)) pixels.push([x, y]); }
  return pixels;
}
function CircleTool({ onNotify }: ToolProps) {
  const [diameter, setDiameter] = useState(21); const [filled, setFilled] = useState(false); const [grid, setGrid] = useState(true); const [color, setColor] = useState("#c395ff");
  const pixels = circlePixels(diameter, filled);
  function save() {
    const canvas = document.createElement("canvas"); const unit = 20; canvas.width = diameter * unit; canvas.height = diameter * unit;
    const context = canvas.getContext("2d"); if (!context) { onNotify("Не удалось создать изображение"); return; }
    context.fillStyle = color; pixels.forEach(([x, y]) => context.fillRect(x * unit, y * unit, unit, unit));
    downloadDataUrl(canvas.toDataURL("image/png"), `circle-${diameter}-blocks.png`); onNotify("Схема круга сохранена");
  }
  return <div className="tp-tool-layout"><div className="tp-circle-stage"><svg role="img" aria-label={`Круг диаметром ${diameter} блоков, ${pixels.length} блоков`} className="tp-circle-svg" viewBox={`-1 -1 ${diameter + 2} ${diameter + 2}`} shapeRendering="crispEdges"><defs><pattern id="tp-circle-grid" width={1} height={1} patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#382d42" strokeWidth={.035} /></pattern></defs>{grid && <rect width={diameter} height={diameter} fill="url(#tp-circle-grid)" />}{pixels.map(([x, y]) => <rect key={`${x}-${y}`} x={x + (grid ? .055 : 0)} y={y + (grid ? .055 : 0)} width={grid ? .89 : 1} height={grid ? .89 : 1} fill={color} />)}</svg><div className="tp-circle-stats"><span><strong>{diameter} × {diameter}</strong>РАЗМЕР</span><span><strong>{pixels.length}</strong>БЛОКОВ</span><span><strong>{Math.ceil(pixels.length / 64)}</strong>СТАКОВ</span></div></div><div className="tp-tool-controls">
    <Field title="01 / ДИАМЕТР В БЛОКАХ"><div className="tp-number-row"><button onClick={() => setDiameter(value => Math.max(5, value - 1))} disabled={diameter <= 5} aria-label="Уменьшить диаметр">−</button><input type="number" min={5} max={64} value={diameter} aria-label="Диаметр круга в блоках" onChange={event => setDiameter(Math.max(5, Math.min(64, Number(event.target.value) || 5)))} /><button onClick={() => setDiameter(value => Math.min(64, value + 1))} disabled={diameter >= 64} aria-label="Увеличить диаметр">+</button><span>блоков</span></div><input type="range" className="tp-range" min={5} max={64} value={diameter} aria-label="Настроить диаметр круга" onChange={event => setDiameter(Number(event.target.value))} /><div className="tp-range-ends"><span>5</span><span>64</span></div></Field>
    <Field title="02 / СХЕМА"><CheckField checked={filled} onChange={setFilled}>Заполнить круг</CheckField><CheckField checked={grid} onChange={setGrid}>Показать сетку</CheckField></Field>
    <Field title="03 / ЦВЕТ БЛОКОВ"><Swatches value={color} onChange={setColor} /></Field>
    <div className="tp-tip"><Sparkles size={17} /><span>Каждая клетка — один блок. Схема симметрична и подходит для строительства в любом мире.</span></div><button className="tp-button tp-primary tp-wide" onClick={save}><Download size={16} />Скачать схему PNG</button>
  </div></div>;
}

function initialBanner() { return Array.from({ length: 72 }, (_, index) => { const x = index % 6, y = Math.floor(index / 6); return (x === 2 || x === 3 || y === 4 || y === 5) ? "#c395ff" : "#372e3f"; }); }
function CardVisual({ id }: { id: ToolId }) {
  if (id === "circle") return <div className="tp-card-circle"><svg viewBox="0 0 11 11" shapeRendering="crispEdges">{circlePixels(11, false).map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width={.8} height={.8} />)}</svg><span>21 × 21</span></div>;
  if (id === "heading") return <div className="tp-card-heading">LEVEL<br /><span>UP!</span></div>;
  if (id === "banner") return <div className="tp-card-banner"><span /><div>{initialBanner().map((color, index) => <i key={index} style={{ backgroundColor: color }} />)}</div></div>;
  return <div className="tp-card-avatar"><div className="tp-pixel-head"><i /><i /><i /><i /></div><span>+</span><div className="tp-avatar-corner" /></div>;
}

export default function ToolsPanel({ onNotify, onCreatePose, activeTool: active, onToolChange }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const selected = TOOLS.find(tool => tool.id === active);
  useEffect(() => { if (active) heading.current?.focus({ preventScroll: true }); }, [active]);
  function open(id: ToolId | null) { onToolChange(id); requestAnimationFrame(() => heading.current?.focus()); }
  return <div className="tp-tools">
    {active && selected ? <>
      <div className="tp-active-heading">
        <button className="tp-back" onClick={() => open(null)} aria-label="Назад к инструментам"><ArrowLeft size={18} /></button>
        <div><span className="tp-eyebrow">ИНСТРУМЕНТЫ / {selected.tag}</span><h1 ref={heading} tabIndex={-1}>{selected.title}</h1></div>
        <span className="tp-local-badge"><span />ЛОКАЛЬНО</span>
      </div>
      <div className="tp-active-tool">
        {active === "avatar" && <AvatarMaker onNotify={onNotify} />}
        {active === "circle" && <CircleTool onNotify={onNotify} />}
        {active === "heading" && <HeadingGenerator onNotify={onNotify} />}
        {active === "banner" && <BannerMaker onNotify={onNotify} />}
      </div>
    </> : <>
      <div className="tp-gallery-heading">
        <div><span className="tp-eyebrow">ИНСТРУМЕНТЫ</span><h1 ref={heading} tabIndex={-1}>Всё для твоих идей</h1><p>Выбери инструмент, чтобы начать. Результат можно скачать в PNG.</p></div>
        <span className="tp-local-badge">{TOOLS.length} ИНСТРУМЕНТА</span>
      </div>
      <div className="tp-tool-grid">
        {TOOLS.map(tool => <button
          className={`tp-tool-card tp-tool-kind-${tool.id}`}
          key={tool.id}
          onClick={() => open(tool.id)}
          style={{ "--tp-card-accent": tool.color } as CSSProperties}
        >
          <div className="tp-card-preview" aria-hidden="true">
            <div className="tp-card-top"><span><tool.icon size={17} /></span><span className="tp-card-tag">{tool.tag}</span></div>
            <CardVisual id={tool.id} />
          </div>
          <div className="tp-card-copy">
            <h2>{tool.title}</h2>
            <p>{tool.description}</p>
            <span className="tp-card-open">Открыть инструмент<ArrowUpRight size={16} /></span>
          </div>
        </button>)}
        <div className="tp-tool-card tp-next-card">
          <span className="tp-next-grid"><WandSparkles size={24} /></span>
          <span className="tp-eyebrow">РЕДАКТОРЫ</span>
          <h2>От идеи — к целой сцене</h2>
          <p>Загрузи свой скин, выбери позу и найди лучший ракурс в 3D-редакторе.</p>
          <div className="tp-next-actions">
            <button className="tp-button" onClick={onCreatePose}><UserRound size={15} />Редактор поз<ArrowUpRight size={14} /></button>
          </div>
        </div>
      </div>
      <div className="tp-gallery-footer"><span /><p>Все инструменты работают в браузере. Загруженные файлы остаются на устройстве.</p></div>
    </>}
  </div>;
}
