"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Clapperboard, Download, FileJson, Frame, Grid2X2, ImageDown, Layers3, Move3D, Package, Redo2, RotateCcw, Save, SlidersHorizontal, Sparkles, Undo2, Upload, UserRound, X } from "lucide-react";
import MinecraftScene, { type MinecraftSceneHandle } from "./minecraft-scene";
import { DEFAULT_POSE, PRESETS, type BodyPart, type Project, type SceneSettings } from "@/lib/types";
import { downloadDataUrl, downloadJson, validateSkin } from "@/lib/files";
import { migrateItems } from "@/lib/items";
import ItemsPanel from "./items-panel";
import "./pose-editor.css";

type Props = { project: Project; onSave: (project: Project) => void; onBack: () => void; onNotify: (message: string) => void; onCharacterChange?: (skin: string, slim: boolean) => void; onAnimate?: (project: Project) => void };
const PARTS: { id: BodyPart; name: string; short: string }[] = [
  { id: "head", name: "Голова", short: "Голова" },
  { id: "body", name: "Корпус", short: "Корпус" },
  { id: "leftArm", name: "Левая рука", short: "Л. рука" },
  { id: "rightArm", name: "Правая рука", short: "П. рука" },
  { id: "leftLeg", name: "Левая нога", short: "Л. нога" },
  { id: "rightLeg", name: "Правая нога", short: "П. нога" },
];
const BACKGROUNDS = ["#21192d", "#694d85", "#69509a", "#427b9b", "#dba95f", "#eeeeE5", "#151515"];
const clone = <T,>(value: T): T => structuredClone(value);
const safeName = (name: string) => name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "minepose";

function Toggle({ value, onChange, label, hint }: { value: boolean; onChange: () => void; label: string; hint?: string }) {
  return <button className="pe-toggle-row" onClick={onChange} role="switch" aria-checked={value}><span>{label}{hint && <small>{hint}</small>}</span><span className={`pe-switch ${value ? "is-on" : ""}`}><span /></span></button>;
}

export default function PoseEditor({ project, onSave, onBack, onNotify, onCharacterChange, onAnimate }: Props) {
  const [draft, setDraft] = useState<Project>(() => ({ ...clone(project), scene: { ...clone(project.scene), items: clone(project.scene.items ?? migrateItems(project.scene.sword)), sword: false } }));
  const draftRef = useRef(draft);
  const sceneRef = useRef<MinecraftSceneHandle>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const skinInput = useRef<HTMLInputElement>(null);
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);
  const gesture = useRef<Project | null>(null);
  const [, setHistoryVersion] = useState(0);
  const [part, setPart] = useState<BodyPart>("head");
  const [tab, setTab] = useState<"pose" | "items" | "scene">("pose");
  const [itemsReady, setItemsReady] = useState(true);
  const [itemsError, setItemsError] = useState("");
  const [transparent, setTransparent] = useState(false);
  const [resolution, setResolution] = useState(1080);
  const [framing, setFraming] = useState(false);
  const [frameSize, setFrameSize] = useState(240);
  const [savedFingerprint, setSavedFingerprint] = useState(project.preview ? JSON.stringify(project) : "");
  const [skinLoading, setSkinLoading] = useState(false);
  const [presetId, setPresetId] = useState(PRESETS.find(value => value.name === project.name)?.id || PRESETS[0].id);
  const [fitKey, setFitKey] = useState(0);
  const isDirty = JSON.stringify(draft) !== savedFingerprint;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resizeFrame = () => setFrameSize(Math.max(160, Math.floor(Math.min(viewport.clientWidth - 40, viewport.clientHeight - 128))));
    resizeFrame();
    const observer = new ResizeObserver(resizeFrame);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  function replaceDraft(next: Project) { draftRef.current = next; setDraft(next); }
  function update(change: (value: Project) => Project, record = true) {
    const previous = draftRef.current;
    const next = change(previous);
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    if (record) { past.current = [...past.current.slice(-59), clone(previous)]; future.current = []; setHistoryVersion(v => v + 1); }
    replaceDraft(next);
  }
  function startGesture() { if (!gesture.current) gesture.current = clone(draftRef.current); }
  function endGesture() {
    if (gesture.current && JSON.stringify(gesture.current) !== JSON.stringify(draftRef.current)) {
      past.current = [...past.current.slice(-59), gesture.current]; future.current = []; setHistoryVersion(v => v + 1);
    }
    gesture.current = null;
  }
  function undo() {
    endGesture(); const previous = past.current.pop();
    if (!previous) return;
    future.current.push(clone(draftRef.current)); replaceDraft(previous); setHistoryVersion(v => v + 1);
  }
  function redo() {
    endGesture(); const next = future.current.pop();
    if (!next) return;
    past.current.push(clone(draftRef.current)); replaceDraft(next); setHistoryVersion(v => v + 1);
  }
  function changeSettings(change: Partial<SceneSettings>) { update(current => ({ ...current, scene: { ...current.scene, ...change } })); }
  function applyPreset() {
    const preset = PRESETS.find(value => value.id === presetId);
    if (!preset) return;
    endGesture();
    update(current => ({ ...current, pose: clone(preset.pose), scene: { ...current.scene, items: clone(preset.items), sword: false, modelPosition: clone(preset.position), modelRotation: clone(preset.rotation), partOffsets: {}, previewCamera: preset.camera ? { ...preset.camera } : undefined } }));
    setFitKey(value => value + 1);
  }
  function setModelVector(field: "modelPosition" | "modelRotation", axis: "x" | "y" | "z", value: number, record = true) {
    if (!Number.isFinite(value)) return;
    const limit = field === "modelPosition" ? 4 : 180;
    update(current => ({ ...current, scene: { ...current.scene, [field]: { ...(current.scene[field] || { x: 0, y: 0, z: 0 }), [axis]: Math.max(-limit, Math.min(limit, value)) } } }), record);
  }
  function setRotation(axis: "x" | "y" | "z", value: number, record = true) {
    update(current => ({ ...current, pose: { ...current.pose, [part]: { ...current.pose[part], [axis]: value } } }), record);
  }
  function setPartOffset(axis: "x" | "y" | "z", value: number, record = true) {
    if (!Number.isFinite(value)) return;
    const offset = Math.max(-0.75, Math.min(0.75, value));
    update(current => ({ ...current, scene: { ...current.scene, partOffsets: { ...current.scene.partOffsets, [part]: { x: 0, y: 0, z: 0, ...current.scene.partOffsets?.[part], [axis]: offset } } } }), record);
  }
  function save() {
    endGesture();
    const current = draftRef.current;
    if (!current.name.trim()) { onNotify("Дайте проекту название"); return; }
    let preview = current.preview;
    try { preview = sceneRef.current?.capture(480, 360) || preview; } catch { /* A project can still be saved without a preview. */ }
    const saved = { ...current, name: current.name.trim(), updatedAt: Date.now(), preview };
    try {
      onSave(saved);
      replaceDraft(saved);
      setSavedFingerprint(JSON.stringify(saved));
      onNotify("Поза сохранена в браузере");
    } catch {
      // The persistence owner reports the failure. Keep the current draft unsaved.
    }
  }
  function exportPng() {
    try {
      const dataUrl = sceneRef.current?.capture(resolution, resolution, transparent);
      if (!dataUrl) throw new Error("Сцена ещё загружается. Попробуйте через секунду");
      downloadDataUrl(dataUrl, `${safeName(draftRef.current.name)}.png`);
      onNotify(`PNG ${resolution} × ${resolution} сохранён`);
    } catch (error) { onNotify(error instanceof Error ? error.message : "Не удалось экспортировать изображение"); }
  }
  async function uploadSkin(file?: File) {
    if (!file) return;
    setSkinLoading(true);
    try { const skin = await validateSkin(file); changeSettings({ skin }); onCharacterChange?.(skin, draftRef.current.scene.slim); onNotify("Скин загружен"); }
    catch (error) { onNotify(error instanceof Error ? error.message : "Не удалось загрузить скин"); }
    finally { setSkinLoading(false); if (skinInput.current) skinInput.current.value = ""; }
  }
  const actionsRef = useRef({ undo, redo, save });
  actionsRef.current = { undo, redo, save };
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement)?.tagName;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); actionsRef.current.save(); }
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? actionsRef.current.redo() : actionsRef.current.undo(); }
      if (event.key.toLowerCase() === "y") { event.preventDefault(); actionsRef.current.redo(); }
    }
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, []);

  const currentPart = PARTS.find(item => item.id === part)!;
  return <div className="pe-editor">
    <div className="pe-topbar">
      <button className="pe-icon-button" onClick={onBack} aria-label="Вернуться к проектам"><ArrowLeft size={18} /></button>
      <div className="pe-project-name">
        <span className="pe-eyebrow">РЕДАКТОР ПОЗ / ЛИЧНЫЙ ПРОЕКТ</span>
        <input aria-label="Название проекта" value={draft.name} maxLength={80} onFocus={startGesture} onBlur={endGesture} onChange={event => update(current => ({ ...current, name: event.target.value }), false)} />
      </div>
      <span className={`pe-save-status ${isDirty ? "is-dirty" : ""}`}><span />{isDirty ? "Есть изменения" : "Сохранено локально"}</span>
      {onAnimate && <button className="pe-button pe-animate-button" onClick={() => { endGesture(); onAnimate(clone(draftRef.current)); }}><Clapperboard size={16} /><span>Создать анимацию</span></button>}
      <button className="pe-button pe-primary" onClick={save}><Save size={16} /><span>Сохранить позу</span></button>
    </div>

    <div className="pe-workspace">
      <section ref={viewportRef} className={`pe-viewport ${framing ? "is-framing" : ""}`} aria-label="Трёхмерная сцена">
        <div className={`pe-scene-frame ${framing ? "is-export-frame" : ""} ${framing && transparent ? "is-transparent" : ""}`} style={framing ? { width: frameSize, height: frameSize } : undefined}>
          <MinecraftScene ref={sceneRef} pose={draft.pose} settings={framing && transparent ? { ...draft.scene, background: "transparent", floor: false, grid: false } : draft.scene} interactive autoFrame fitKey={fitKey} onSelectPart={setPart} selectedPart={framing ? null : part} onItemsReady={(ready, error) => { setItemsReady(ready); setItemsError(error || ""); }} className="pe-scene" />
        </div>
        <div className="pe-viewport-top">
          <div className="pe-view-controls">
            <span className="pe-view-badge"><span />ПЕРСПЕКТИВА</span>
            <button className={`pe-alignment-button ${framing ? "is-active" : ""}`} onClick={() => setFraming(value => !value)} aria-pressed={framing} title={framing ? "Вернуться к полному виду сцены" : "Показать кадр так, как он сохранится в PNG"}><Frame size={15} /><span>Выравнивание</span></button>
          </div>
          <div className="pe-history-tools">
            <button className="pe-icon-button" disabled={!past.current.length} onClick={undo} title="Отменить (Ctrl+Z)" aria-label="Отменить"><Undo2 size={16} /></button>
            <button className="pe-icon-button" disabled={!future.current.length} onClick={redo} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить"><Redo2 size={16} /></button>
            <span />
            <button className="pe-icon-button" onClick={() => sceneRef.current?.resetCamera()} title="Сбросить камеру" aria-label="Сбросить камеру"><RotateCcw size={16} /></button>
          </div>
        </div>
        <div className="pe-body-map" aria-label="Выбор части тела" hidden={framing}>
          <span className="pe-eyebrow">МОДЕЛЬ</span>
          <div className="pe-body-figure">
            {PARTS.map(item => <button key={item.id} aria-label={`Выбрать: ${item.name}`} title={item.name} className={`pe-part-${item.id} ${part === item.id ? "is-selected" : ""}`} onClick={() => { setPart(item.id); setTab("pose"); }} />)}
          </div>
          <span>{currentPart.short}</span>
        </div>
        <div className="pe-viewport-bottom"><span>{framing ? <><Frame size={14} />Кадр PNG · {resolution} × {resolution}{transparent ? " · Без фона" : ""}</> : <><Move3D size={15} />Тяните для вращения · Колесо для масштаба</>}</span><span className="pe-coordinates">{framing ? "1 : 1" : "X / Y / Z"}</span></div>
        {(!itemsReady || itemsError) && <div className={`pe-items-status ${itemsError ? "is-error" : ""}`} role={itemsError ? "alert" : "status"}>{itemsError || "Загружаем 3D-предметы…"}</div>}
      </section>

      <aside className="pe-panel">
        <div className="pe-tabs" role="tablist" aria-label="Настройки редактора">
          <button role="tab" aria-selected={tab === "pose"} className={tab === "pose" ? "is-active" : ""} onClick={() => setTab("pose")}><UserRound size={16} />Поза</button>
          <button role="tab" aria-selected={tab === "items"} className={tab === "items" ? "is-active" : ""} onClick={() => setTab("items")}><Package size={16} />Предметы</button>
          <button role="tab" aria-selected={tab === "scene"} className={tab === "scene" ? "is-active" : ""} onClick={() => setTab("scene")}><Layers3 size={16} />Сцена</button>
        </div>
        <div className="pe-panel-content">
          {tab === "pose" ? <>
            <section className="pe-section">
              <div className="pe-section-title"><span><Sparkles size={15} />Быстрый старт</span><span className="pe-tiny-badge">12 ПОЗ</span></div>
              <div className="pe-template-select"><div className="pe-select-wrap"><select aria-label="Готовая поза" value={presetId} onChange={event => setPresetId(event.target.value)}>{PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select><ChevronDown size={14} /></div><button className="pe-button" onClick={applyPreset}>Применить шаблон</button></div>
            </section>
            <section className="pe-section">
              <div className="pe-section-title"><span><SlidersHorizontal size={15} />Положение тела</span><button className="pe-small-button" onClick={() => { update(current => ({ ...current, pose: clone(DEFAULT_POSE), scene: { ...current.scene, partOffsets: {}, modelPosition: { x: 0, y: 0, z: 0 }, modelRotation: { x: 0, y: 0, z: 0 } } })); setFitKey(value => value + 1); }}>Сбросить всё</button></div>
              <label className="pe-label" htmlFor="pe-part-select">ЧАСТЬ ТЕЛА</label>
              <div className="pe-select-wrap"><select id="pe-part-select" value={part} onChange={event => setPart(event.target.value as BodyPart)}>{PARTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></div>
              <div className="pe-rotation-heading"><span>Смещение от центра</span><button className="pe-small-button" onClick={() => { endGesture(); update(current => ({ ...current, scene: { ...current.scene, partOffsets: { ...current.scene.partOffsets, [part]: { x: 0, y: 0, z: 0 } } } })); }} title="Сбросить смещение по X, Y и Z"><RotateCcw size={13} />Сбросить</button></div>
              {(["x", "y", "z"] as const).map(axis => { const value = draft.scene.partOffsets?.[part]?.[axis] ?? 0; return <div className="pe-axis-row pe-offset-row" key={`offset-${axis}`}><label htmlFor={`pe-offset-${axis}`} className={`pe-axis-label pe-axis-${axis}`}>{axis.toUpperCase()}</label><input id={`pe-offset-${axis}`} aria-label={`Смещение ${currentPart.name}: ${axis.toUpperCase()}, в единицах модели`} aria-valuetext={`${value.toFixed(2)} единицы`} type="range" min={-0.75} max={0.75} step={0.01} value={value} onPointerDown={startGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onKeyDown={startGesture} onKeyUp={endGesture} onBlur={endGesture} onChange={event => { if (!gesture.current) startGesture(); setPartOffset(axis, Number(event.target.value), false); }} /><span className="pe-offset-value">{value > 0 ? "+" : ""}{value.toFixed(2)}</span></div>; })}
              <div className="pe-hint"><span className="pe-hint-dot" />{part === "leftArm" || part === "leftLeg" ? "X: + от корпуса, − к корпусу." : part === "rightArm" || part === "rightLeg" ? "X: − от корпуса, + к корпусу." : part === "head" ? "Y: + вверх, − к корпусу." : "Сдвигай корпус по X, Y и Z."} Z перемещает часть вперёд или назад.</div>
              <div className="pe-rotation-heading"><span>Вращение</span><button className="pe-small-button" onClick={() => update(current => ({ ...current, pose: { ...current.pose, [part]: clone(DEFAULT_POSE[part]) } }))} title="Сбросить вращение части тела"><RotateCcw size={13} />Сбросить</button></div>
              {(["x", "y", "z"] as const).map(axis => <div className="pe-axis-row" key={axis}><label htmlFor={`pe-axis-${axis}`} className={`pe-axis-label pe-axis-${axis}`}>{axis.toUpperCase()}</label><input id={`pe-axis-${axis}`} aria-label={`Вращение ${currentPart.name}: ${axis.toUpperCase()}`} type="range" min={-180} max={180} step={1} value={draft.pose[part][axis]} onPointerDown={startGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onKeyDown={startGesture} onKeyUp={endGesture} onBlur={endGesture} onChange={event => { if (!gesture.current) startGesture(); setRotation(axis, Number(event.target.value), false); }} /><div className="pe-degree-input"><input aria-label={`Угол ${axis.toUpperCase()} в градусах`} type="number" min={-180} max={180} value={draft.pose[part][axis]} onChange={event => setRotation(axis, Math.max(-180, Math.min(180, Number(event.target.value))))} /><span>°</span></div></div>)}
              <div className="pe-hint"><span className="pe-hint-dot" />Можно выбрать часть тела прямо на модели.</div>
            </section>
            <section className="pe-section">
              <div className="pe-section-title"><span><UserRound size={15} />Скин персонажа</span>{draft.scene.skin && <span className="pe-tiny-badge pe-loaded">ЗАГРУЖЕН</span>}</div>
              <button className="pe-upload" onClick={() => skinInput.current?.click()} disabled={skinLoading}><Upload size={19} /><span>{skinLoading ? "Загрузка скина…" : draft.scene.skin ? "Заменить скин" : "Загрузить свой скин"}<small>PNG · 64 × 64 или 64 × 32</small></span></button>
              {draft.scene.skin && <button className="pe-small-button pe-reset-skin" onClick={() => { changeSettings({ skin: "" }); onCharacterChange?.("", draft.scene.slim); }}><X size={12} />Стандартный скин</button>}
              <Toggle label="Тонкие руки" hint="Модель Alex" value={draft.scene.slim} onChange={() => { changeSettings({ slim: !draft.scene.slim }); onCharacterChange?.(draft.scene.skin, !draft.scene.slim); }} />
            </section>
            <section className="pe-section pe-placement-section"><details><summary><Move3D size={15} /><span>Персонаж в сцене</span><ChevronDown size={14} /></summary><div className="pe-placement-fields">{(["modelPosition", "modelRotation"] as const).map(field => <fieldset key={field}><legend>{field === "modelPosition" ? "Смещение персонажа" : "Вращение персонажа"}</legend>{(["x", "y", "z"] as const).map(axis => <div className="pe-axis-row" key={axis}><label className={`pe-axis-label pe-axis-${axis}`} htmlFor={`pe-${field}-${axis}`}>{axis.toUpperCase()}</label><input aria-label={`${field === "modelPosition" ? "Смещение" : "Поворот"} персонажа ${axis.toUpperCase()}`} type="range" min={field === "modelPosition" ? -4 : -180} max={field === "modelPosition" ? 4 : 180} step={field === "modelPosition" ? .05 : 1} value={draft.scene[field]?.[axis] || 0} onPointerDown={startGesture} onPointerUp={endGesture} onPointerCancel={endGesture} onKeyDown={startGesture} onKeyUp={endGesture} onBlur={endGesture} onChange={event => { if (!gesture.current) startGesture(); setModelVector(field, axis, Number(event.target.value), false); }} /><div className="pe-degree-input"><input id={`pe-${field}-${axis}`} aria-label={`${field === "modelPosition" ? "Координата" : "Угол"} персонажа ${axis.toUpperCase()}`} type="number" min={field === "modelPosition" ? -4 : -180} max={field === "modelPosition" ? 4 : 180} step={field === "modelPosition" ? .05 : 1} value={draft.scene[field]?.[axis] || 0} onFocus={startGesture} onBlur={endGesture} onChange={event => setModelVector(field, axis, Number(event.target.value), false)} />{field === "modelRotation" && <span>°</span>}</div></div>)}</fieldset>)}<button className="pe-small-button" onClick={() => { endGesture(); update(current => ({ ...current, scene: { ...current.scene, modelPosition: { x: 0, y: 0, z: 0 }, modelRotation: { x: 0, y: 0, z: 0 } } })); setFitKey(value => value + 1); }}><RotateCcw size={12} />Сбросить положение в сцене</button></div></details></section>
          </> : tab === "items" ? <ItemsPanel items={draft.scene.items!} onGestureStart={startGesture} onGestureEnd={endGesture} onChange={items => update(current => ({ ...current, scene: { ...current.scene, items, sword: false } }), !gesture.current)} /> : <>
            <section className="pe-section">
              <div className="pe-section-title"><span><Layers3 size={15} />Окружение</span></div>
              <label className="pe-label">ЦВЕТ ФОНА</label>
              <div className="pe-swatches">{BACKGROUNDS.map(color => <button key={color} className={draft.scene.background.toLowerCase() === color.toLowerCase() ? "is-selected" : ""} style={{ backgroundColor: color }} aria-label={`Фон ${color}`} onClick={() => changeSettings({ background: color })}>{draft.scene.background.toLowerCase() === color.toLowerCase() && <Check size={14} />}</button>)}<label className="pe-custom-color" title="Свой цвет"><span>+</span><input aria-label="Свой цвет фона" type="color" value={draft.scene.background} onChange={event => changeSettings({ background: event.target.value })} /></label></div>
              <Toggle label="Пол" hint="Плоскость под персонажем" value={draft.scene.floor} onChange={() => changeSettings({ floor: !draft.scene.floor })} />
              <Toggle label="Сетка" hint="Ориентир в пространстве" value={draft.scene.grid} onChange={() => changeSettings({ grid: !draft.scene.grid })} />
            </section>
            <section className="pe-section">
              <div className="pe-section-title"><span><Sparkles size={15} />Освещение</span><span className="pe-tiny-badge">{draft.scene.light.toFixed(1)}×</span></div>
              <label className="pe-label" htmlFor="pe-light">ЯРКОСТЬ СВЕТА</label><input id="pe-light" className="pe-full-range" aria-label="Яркость света" type="range" min={0.3} max={3} step={0.1} value={draft.scene.light} onPointerDown={startGesture} onPointerUp={endGesture} onKeyDown={startGesture} onKeyUp={endGesture} onBlur={endGesture} onChange={event => { if (!gesture.current) startGesture(); update(current => ({ ...current, scene: { ...current.scene, light: Number(event.target.value) } }), false); }} />
              <div className="pe-range-ticks"><span>Мягкий</span><span>Яркий</span></div>
            </section>
            <div className="pe-scene-note"><Grid2X2 size={23} /><p>Соберите свою сцену<small>Изменяйте фон, освещение и ракурс. При экспорте можно убрать фон целиком.</small></p></div>
          </>}
        </div>
        <div className="pe-export-section">
          <div className="pe-section-title"><span><ImageDown size={15} />Экспорт изображения</span></div>
          <div className="pe-export-options"><div className="pe-select-wrap"><select aria-label="Разрешение PNG" value={resolution} onChange={event => setResolution(Number(event.target.value))}><option value={720}>720 × 720</option><option value={1080}>1080 × 1080</option><option value={2048}>2048 × 2048</option></select><ChevronDown size={13} /></div><label className="pe-check-label"><input type="checkbox" checked={transparent} onChange={event => setTransparent(event.target.checked)} />Без фона</label></div>
          <button className="pe-button pe-primary pe-full-button" disabled={!itemsReady} onClick={exportPng}><Download size={16} />Скачать PNG</button>
          <button className="pe-button pe-json-export" onClick={() => { downloadJson(draftRef.current, `${safeName(draftRef.current.name)}.minepose.json`); onNotify("Файл проекта сохранён"); }}><FileJson size={14} />Скачать файл проекта</button>
        </div>
      </aside>
    </div>
    <input ref={skinInput} type="file" className="pe-hidden-input" accept="image/png" onChange={event => uploadSkin(event.target.files?.[0])} aria-label="Файл скина" />
    <div className="pe-editor-footer"><span><span />ВСЁ ОСТАЁТСЯ НА ВАШЕМ УСТРОЙСТВЕ</span><span>CTRL + S <span className="pe-footer-muted">СОХРАНИТЬ</span><span className="pe-footer-separator">/</span> CTRL + Z <span className="pe-footer-muted">ОТМЕНИТЬ</span></span></div>
  </div>;
}
