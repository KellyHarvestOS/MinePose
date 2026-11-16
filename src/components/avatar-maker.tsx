"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Box, Check, ChevronDown, Copy, Download, ImageUp, LoaderCircle, Maximize, Palette, RotateCcw, Search, SlidersHorizontal, Sparkles, Upload, UserRound } from "lucide-react";
import MinecraftScene, { type MinecraftSceneHandle } from "./minecraft-scene";
import { AVATAR_PRESETS, DEFAULT_AVATAR, type AvatarSettings } from "@/lib/avatars";
import { avatarFrame, composeAvatar } from "@/lib/avatar-renderer";
import { DEFAULT_POSE, DEFAULT_SCENE, PRESETS, type Pose } from "@/lib/types";
import { downloadDataUrl, validateSkin } from "@/lib/files";
import "./avatar-maker.css";

type Props = { onNotify: (message: string) => void };
const COLORS = ["#9955d7", "#ed616b", "#4b88dc", "#e8ac57", "#58a5a4", "#e3dbe9", "#25232b"];
const GRADIENTS = [
  { name: "Аметист", color: "#9955d7", endColor: "#35234e" },
  { name: "Небо", color: "#4c8ee5", endColor: "#c0dfec" },
  { name: "Закат", color: "#dc6a8a", endColor: "#ffd080" },
  { name: "Сумерки", color: "#7483c9", endColor: "#292337" },
];
const POSES: { value: string; name: string; pose: Pose }[] = [
  { value: "0", name: "Спокойная", pose: DEFAULT_POSE },
  { value: "1", name: "Всем привет!", pose: PRESETS[1].pose },
  { value: "2", name: "В движении", pose: PRESETS[0].pose },
  { value: "3", name: "Уверенная", pose: AVATAR_PRESETS[3].pose },
];

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const [hex, setHex] = useState(value.toUpperCase());
  useEffect(() => setHex(value.toUpperCase()), [value]);
  function commit() { if (/^#[\da-f]{6}$/i.test(hex)) onChange(hex.toLowerCase()); else setHex(value.toUpperCase()); }
  return <label className="am-color-field"><span>{label}</span><div><span className="am-color-wheel" style={{ background: value }}><input type="color" aria-label={`${label} — палитра`} value={value} onChange={event => onChange(event.target.value)} /></span><input type="text" aria-label={label} value={hex} maxLength={7} spellCheck={false} onChange={event => { const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`; setHex(next.toUpperCase()); if (/^#[\da-f]{6}$/i.test(next)) onChange(next.toLowerCase()); }} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") commit(); }} /></div></label>;
}

function Range({ label, value, min, max, suffix = "", onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="am-range"><span>{label}<output>{value}{suffix}</output></span><input type="range" aria-label={label} value={value} min={min} max={max} onChange={event => onChange(Number(event.target.value))} /></label>;
}

export default function AvatarMaker({ onNotify }: Props) {
  const [settings, setSettings] = useState<AvatarSettings>(() => structuredClone(DEFAULT_AVATAR));
  const [nickname, setNickname] = useState("");
  const [skinError, setSkinError] = useState("");
  const [loadingSkin, setLoadingSkin] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<"download" | "copy" | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [pose, setPose] = useState("0");
  const [viewChanged, setViewChanged] = useState(false);
  const sceneRef = useRef<MinecraftSceneHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const uploadRevision = useRef(0);
  const selected = AVATAR_PRESETS.find(preset => preset.id === settings.preset) || AVATAR_PRESETS[0];
  const inset = avatarFrame(settings);
  const round = settings.round ? 40 : 0;
  const photoBackground = settings.background === "solid" ? settings.color : settings.background === "gradient" ? `linear-gradient(180deg, ${settings.color}, ${settings.endColor})` : "transparent";
  const patch = (next: Partial<AvatarSettings>) => setSettings(previous => ({ ...previous, ...next }));
  const onReady = useCallback((value: boolean) => setReady(value), []);
  const onViewChange = useCallback(() => setViewChanged(true), []);
  useEffect(() => () => { requestRef.current?.abort(); uploadRevision.current++; }, []);

  function resetSettings() {
    requestRef.current?.abort(); uploadRevision.current++;
    if (settings.skin || settings.slim || settings.preset !== DEFAULT_AVATAR.preset) setReady(false);
    setLoadingSkin(false); setSkinError(""); setNickname(""); setPose("0");
    setSettings(structuredClone(DEFAULT_AVATAR));
    sceneRef.current?.resetCamera(); setViewChanged(false);
  }

  function choosePreset(preset: typeof AVATAR_PRESETS[number]) {
    if (preset.id !== settings.preset) setReady(false);
    setViewChanged(false);
    setPose(preset.id === "confident" ? "3" : "0");
    patch({ preset: preset.id, pose: structuredClone(preset.pose), background: "gradient", color: preset.color, endColor: preset.endColor, frame: preset.frame, zoom: 100 });
    if (preset.id === settings.preset) sceneRef.current?.resetCamera();
  }

  function setSkin(skin: string, skinName: string, slim = settings.slim) {
    if (skin !== settings.skin || slim !== settings.slim) setReady(false);
    setSkinError(""); patch({ skin, skinName, slim });
  }

  async function upload(file?: File) {
    if (!file) return;
    requestRef.current?.abort(); setLoadingSkin(false);
    const current = ++uploadRevision.current;
    try {
      const skin = await validateSkin(file);
      if (current !== uploadRevision.current) return;
      setSkin(skin, file.name.replace(/\.png$/i, ""));
      onNotify("Скин загружен");
    } catch (error) {
      if (current !== uploadRevision.current) return;
      const message = error instanceof Error ? error.message : "Не удалось загрузить скин";
      setSkinError(message); onNotify(message);
    } finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function findSkin(event: React.FormEvent) {
    event.preventDefault();
    const name = nickname.trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(name)) { setSkinError("Никнейм Java Edition: от 3 до 16 латинских букв, цифр или _"); return; }
    requestRef.current?.abort();
    uploadRevision.current++;
    const controller = new AbortController(); requestRef.current = controller;
    setLoadingSkin(true); setSkinError("");
    try {
      const response = await fetch(`/api/skin?name=${encodeURIComponent(name)}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Не удалось найти скин. Попробуйте загрузить PNG.");
      if (typeof data.skin !== "string" || !data.skin.startsWith("data:image/png;base64,")) throw new Error("Не удалось загрузить скин игрока");
      if (controller.signal.aborted) return;
      setSkin(data.skin, typeof data.name === "string" ? data.name : name, Boolean(data.slim));
      onNotify(`Скин ${data.name || name} загружен`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setSkinError(error instanceof Error ? error.message : "Не удалось загрузить скин. Попробуйте PNG-файл.");
    } finally { if (requestRef.current === controller) setLoadingSkin(false); }
  }

  async function exportImage(action: "download" | "copy") {
    if (!ready || loadingSkin || busy) return;
    setBusy(action);
    try {
      const render = sceneRef.current?.capture(settings.resolution, settings.resolution, true);
      if (!render) throw new Error("Дождитесь загрузки персонажа");
      const canvas = await composeAvatar(settings, render);
      if (action === "download") {
        downloadDataUrl(canvas.toDataURL("image/png"), `minepose-avatar-${settings.resolution}.png`);
        onNotify(`Аватарка ${settings.resolution} × ${settings.resolution} сохранена`);
      } else {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Браузер не поддерживает копирование PNG. Скачайте изображение.");
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Не удалось скопировать PNG")), "image/png"));
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        onNotify("Аватарка скопирована");
      }
    } catch (error) { onNotify(error instanceof DOMException && error.name === "NotAllowedError" ? "Браузер не разрешил доступ к буферу обмена. Скачайте PNG." : error instanceof Error ? error.message : "Не удалось сохранить аватарку"); }
    finally { setBusy(null); }
  }

  return <section className="am-maker" aria-label="Мастерская аватарок">
    <div className="am-intro"><p>Твой персонаж. Новый ракурс.<br className="am-mobile-break" /> Выбери образ, добавь свой скин и сохрани аватарку.</p><span><Box size={13} />НАСТОЯЩИЙ 3D</span></div>
    <div className="am-layout">
      <div className="am-preview-column">
        <div className="am-preview-stage tp-avatar-stage">
          <div className="am-stage-top"><span><span />ПРЕДПРОСМОТР</span><span>1 : 1</span></div>
          <div className={`am-photo ${settings.background === "transparent" ? "am-checker" : ""}`} style={{ "--am-inset": `${inset / 1024 * 100}%`, borderRadius: `${round / 1024 * 100}%`, backgroundColor: inset ? settings.frameColor : undefined } as CSSProperties}>
            <div className="am-photo-inner" style={{ background: photoBackground, borderRadius: round ? `${Math.max(0, round - inset) / (1024 - inset * 2) * 100}%` : 0 }}>
              <div className="am-scene-zoom" style={{ transform: `scale(${settings.zoom / 100})` }}><MinecraftScene key={settings.preset} ref={sceneRef} avatar={selected.shot} pose={settings.pose} settings={{ ...DEFAULT_SCENE, skin: settings.skin, slim: settings.slim, background: "transparent", floor: false, grid: false, light: 1.65 }} interactive className="am-main-scene" onReady={onReady} onViewChange={onViewChange} /></div>
            </div>
          </div>
          {!ready && <div className="am-rendering" role="status"><LoaderCircle size={15} className="am-spin" />Загружаем персонажа</div>}
          <div className="am-stage-bottom"><span><Box size={13} />{viewChanged ? "Сохранится выбранный ракурс" : "Потяни, чтобы повернуть"}</span><button onClick={() => { sceneRef.current?.resetCamera(); setViewChanged(false); }} aria-label="Сбросить ракурс" title="Вернуть исходный ракурс"><RotateCcw size={15} /></button></div>
        </div>
        <div className="am-quick-backgrounds"><span>Быстрый фон</span><div>{COLORS.slice(0, 5).map(color => <button key={color} aria-label={`Фон ${color}`} title={color} className={settings.background === "solid" && settings.color === color ? "is-selected" : ""} style={{ background: color }} onClick={() => patch({ background: "solid", color })}>{settings.background === "solid" && settings.color === color && <Check size={12} />}</button>)}<i />{GRADIENTS.map(item => <button key={item.name} aria-label={`Градиент ${item.name}`} title={item.name} className={settings.background === "gradient" && settings.color === item.color && settings.endColor === item.endColor ? "is-selected" : ""} style={{ background: `linear-gradient(180deg,${item.color},${item.endColor})` }} onClick={() => patch({ background: "gradient", color: item.color, endColor: item.endColor })}>{settings.background === "gradient" && settings.color === item.color && settings.endColor === item.endColor && <Check size={12} />}</button>)}<button className={`am-checker ${settings.background === "transparent" ? "is-selected" : ""}`} aria-label="Прозрачный фон" title="Прозрачный фон" onClick={() => patch({ background: "transparent" })}>{settings.background === "transparent" && <Check size={12} />}</button></div></div>
        <div className="am-export-bar"><div className="am-export-size"><Maximize size={14} /><select aria-label="Размер аватарки" value={settings.resolution} onChange={event => patch({ resolution: Number(event.target.value) as AvatarSettings["resolution"] })}><option value={512}>512 × 512</option><option value={1024}>1024 × 1024</option><option value={2048}>2048 × 2048</option></select><ChevronDown size={12} /></div><button className="am-copy" disabled={!ready || loadingSkin || Boolean(busy)} aria-label="Скопировать аватарку" title="Скопировать PNG" onClick={() => exportImage("copy")}>{busy === "copy" ? <LoaderCircle size={16} className="am-spin" /> : <Copy size={16} />}</button><button className="am-button am-primary" disabled={!ready || loadingSkin || Boolean(busy)} onClick={() => exportImage("download")}>{busy === "download" ? <LoaderCircle size={16} className="am-spin" /> : <Download size={16} />}Скачать аватарку</button></div>
        <p className="am-export-note">PNG · Без водяного знака · Как в предпросмотре</p>
      </div>

      <div className="am-controls">
        <section className="am-section am-presets-section"><div className="am-section-title"><h2>Начни с образа</h2><span>01</span></div><div className="am-presets">{AVATAR_PRESETS.map(preset => <button key={preset.id} className={`am-preset ${settings.preset === preset.id ? "is-selected" : ""}`} onClick={() => choosePreset(preset)} aria-label={`Образ: ${preset.label}`} aria-pressed={settings.preset === preset.id}><div className="am-preset-art" style={{ background: `linear-gradient(180deg,${preset.color},${preset.endColor})` }}><MinecraftScene avatar={preset.shot} pose={preset.pose} settings={{ ...DEFAULT_SCENE, background: "transparent", floor: false, grid: false, skin: settings.skin, slim: settings.slim, light: 1.65 }} interactive={false} className="am-thumb-scene" />{settings.preset === preset.id && <span className="am-preset-check"><Check size={12} strokeWidth={3} /></span>}</div><span className="am-preset-title">{preset.label}</span><small>{preset.caption}</small></button>)}</div></section>

        <section className="am-section"><div className="am-section-title"><h2>Твой персонаж</h2><UserRound size={14} /></div><label className="am-label" htmlFor="am-nickname">Никнейм Minecraft Java</label><form className="am-nickname" onSubmit={findSkin}><input id="am-nickname" value={nickname} onChange={event => setNickname(event.target.value)} placeholder="Например, Notch" autoComplete="off" spellCheck={false} maxLength={16} aria-describedby={skinError ? "am-skin-error" : undefined} /><button type="submit" disabled={loadingSkin} aria-label="Найти скин" title="Найти скин по никнейму">{loadingSkin ? <LoaderCircle size={16} className="am-spin" /> : <Search size={16} />}</button></form>{skinError && <p className="am-error" id="am-skin-error" role="alert">{skinError}</p>}<div className="am-or"><span />или свой PNG<span /></div><input hidden type="file" accept="image/png" ref={fileRef} aria-label="Загрузить скин аватарки" onChange={event => upload(event.target.files?.[0])} /><button className="am-upload" onClick={() => fileRef.current?.click()}><Upload size={17} /><span>{settings.skin ? "Заменить скин" : "Загрузить скин"}<small>64 × 64 или 64 × 32 · до 2 МБ</small></span><ImageUp size={17} /></button><div className="am-character-info"><span title={settings.skinName}><span />{settings.skinName}</span>{settings.skin && <button aria-label="Вернуть стандартного персонажа" title="Вернуть стандартного персонажа" onClick={() => { requestRef.current?.abort(); uploadRevision.current++; setLoadingSkin(false); setSkin("", DEFAULT_AVATAR.skinName, false); }}>Сбросить</button>}</div><label className="am-checkbox am-model-toggle"><input type="checkbox" checked={settings.slim} aria-label="Тонкие руки (Alex)" onChange={event => { setReady(false); patch({ slim: event.target.checked }); }} /><span>Тонкие руки <small>Alex</small></span></label></section>

        <section className="am-section"><div className="am-section-title"><h2>Настроение фона</h2><Palette size={14} /></div><div className="am-tabs" role="group" aria-label="Тип фона"><button className={settings.background === "solid" ? "is-selected" : ""} aria-pressed={settings.background === "solid"} onClick={() => patch({ background: "solid" })}>Цвет</button><button className={settings.background === "gradient" ? "is-selected" : ""} aria-pressed={settings.background === "gradient"} onClick={() => patch({ background: "gradient" })}>Градиент</button></div><div className="am-color-fields"><ColorField label={settings.background === "gradient" ? "Верхний цвет" : "Цвет фона"} value={settings.color} onChange={color => patch({ color })} />{settings.background === "gradient" && <ColorField label="Нижний цвет" value={settings.endColor} onChange={endColor => patch({ endColor })} />}</div><label className="am-checkbox"><input type="checkbox" checked={settings.background === "transparent"} aria-label="Прозрачный фон при экспорте" onChange={event => patch({ background: event.target.checked ? "transparent" : "gradient" })} /><span>Прозрачный фон <small>PNG</small></span></label></section>

        <section className={`am-section am-adjustments ${advanced ? "is-open" : ""}`}><button className="am-disclosure" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} aria-controls="am-adjustment-fields"><span><SlidersHorizontal size={15} />Поза и оформление</span><ChevronDown size={15} /></button>{advanced && <div className="am-adjustment-fields" id="am-adjustment-fields"><label className="am-select-label"><span>Поза персонажа</span><div><select aria-label="Поза аватарки" value={pose} disabled={selected.shot === "head"} onChange={event => { setPose(event.target.value); patch({ pose: structuredClone(POSES.find(item => item.value === event.target.value)!.pose) }); }}>{POSES.map(item => <option key={item.value} value={item.value}>{item.name}</option>)}</select><ChevronDown size={13} /></div></label><Range label="Масштаб персонажа" min={75} max={135} value={settings.zoom} suffix="%" onChange={zoom => patch({ zoom })} /><div className="am-adjust-divider" /><label className="am-checkbox"><input type="checkbox" checked={settings.frame} disabled={settings.background === "transparent"} onChange={event => patch({ frame: event.target.checked })} /><span>Рамка фотографии</span></label>{settings.frame && settings.background !== "transparent" && <><ColorField label="Цвет рамки" value={settings.frameColor} onChange={frameColor => patch({ frameColor })} /><Range label="Ширина рамки" min={8} max={64} value={settings.frameWidth} suffix=" px" onChange={frameWidth => patch({ frameWidth })} /></>}<label className="am-checkbox"><input type="checkbox" checked={settings.round} onChange={event => patch({ round: event.target.checked })} /><span>Скруглённые углы</span></label></div>}</section>
        <div className="am-tip"><Sparkles size={15} /><p>Свой скин работает во всех образах. Ракурс можно настроить прямо на аватарке.</p></div>
        <button className="am-reset-settings" aria-label="Сбросить настройки аватарки" onClick={resetSettings}><RotateCcw size={12} />Сбросить настройки</button>
      </div>
    </div>
  </section>;
}
