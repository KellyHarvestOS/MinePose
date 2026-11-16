"use client";

import { useMemo, useRef, useState, type PointerEvent } from "react";
import { ChevronDown, ChevronRight, Copy, Diamond, GripHorizontal, Minus, Pause, Play, Plus, Repeat2, Scissors, SkipBack, SkipForward, Trash2 } from "lucide-react";

type TimelineKey = { id: string; time: number };
type TimelineTrack = { id: string; objectId: string; property: string; layerId: string; keyframes: TimelineKey[]; muted?: boolean; locked?: boolean };
type TimelineObject = { id: string; name: string; type: string; audio?: { offset: number; duration: number; trimStart: number; trimEnd: number; peaks: number[]; muted: boolean } };
type Props = {
  tracks: TimelineTrack[];
  objects: TimelineObject[];
  duration: number;
  fps: number;
  time: number;
  playing: boolean;
  loop: boolean;
  speed: number;
  selectedKeys: string[];
  selectedObjectId?: string;
  onTime: (time: number) => void;
  onPlay: () => void;
  onLoop: (value: boolean) => void;
  onSpeed: (value: number) => void;
  onDuration: (value: number) => void;
  onFps: (value: 24 | 30 | 60) => void;
  onSelectObject: (id: string, property?: string) => void;
  onSelectKeys: (ids: string[]) => void;
  onMoveKeys: (updates: { id: string; time: number }[]) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
  onDeleteKeys: () => void;
  onCopyKeys: () => void;
  onPasteKeys: () => void;
  onDuplicateKeys: () => void;
  onAddKey: () => void;
  onStretchKeys: (factor: number) => void;
  range: [number, number];
  onRange: (value: [number, number]) => void;
};

const propertyName = (name: string) => name.replace("pose.head", "Голова").replace("pose.body", "Корпус").replace("pose.rightArm", "Правая рука").replace("pose.leftArm", "Левая рука").replace("pose.rightLeg", "Правая нога").replace("pose.leftLeg", "Левая нога").replace("position", "Позиция").replace("rotation", "Вращение").replace("scale", "Масштаб").replace("opacity", "Прозрачность").replace("visible", "Видимость").replace("camera.fov", "Угол обзора").replace("camera.target", "Цель камеры").replace("light.intensity", "Яркость света").replace("light.color", "Цвет света").replace("parentId", "Привязка").replace("attachment", "Крепление");

export default function AnimationTimeline(props: Props) {
  const [zoom, setZoom] = useState(1);
  const [height, setHeight] = useState(255);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const scroll = useRef<HTMLDivElement>(null);
  const scale = 86 * zoom;
  const width = Math.max(620, props.duration * scale + 30);
  const groups = useMemo(() => props.objects.map(object => ({ object, tracks: props.tracks.filter(track => track.objectId === object.id) })), [props.objects, props.tracks]);
  const snap = (value: number) => Math.max(0, Math.min(props.duration, Math.round(value * props.fps) / props.fps));
  const keys = props.tracks.flatMap(track => track.keyframes);
  function resize(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const y = event.clientY, initial = height;
    const move = (next: globalThis.PointerEvent) => setHeight(Math.max(170, Math.min(520, initial + y - next.clientY)));
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true });
  }
  function scrub(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const area = event.currentTarget;
    area.setPointerCapture(event.pointerId);
    const move = (x: number) => props.onTime(snap((x - area.getBoundingClientRect().left) / scale));
    move(event.clientX);
    const listener = (next: globalThis.PointerEvent) => move(next.clientX);
    const end = () => { area.removeEventListener("pointermove", listener); area.removeEventListener("pointerup", end); area.removeEventListener("pointercancel", end); };
    area.addEventListener("pointermove", listener); area.addEventListener("pointerup", end, { once: true }); area.addEventListener("pointercancel", end, { once: true });
  }
  function dragKey(event: PointerEvent<HTMLButtonElement>, key: TimelineKey) {
    event.stopPropagation();
    if (event.button !== 0) return;
    const selection = event.shiftKey ? props.selectedKeys.includes(key.id) ? props.selectedKeys.filter(id => id !== key.id) : [...props.selectedKeys, key.id] : props.selectedKeys.includes(key.id) ? props.selectedKeys : [key.id];
    props.onSelectKeys(selection);
    if (!selection.includes(key.id)) return;
    props.onTime(key.time);
    props.onGestureStart();
    const origin = event.clientX;
    const initial = keys.filter(value => selection.includes(value.id));
    const control = event.currentTarget; control.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) => {
      const delta = (next.clientX - origin) / scale;
      const lower = Math.min(...initial.map(value => value.time)), upper = Math.max(...initial.map(value => value.time));
      const bounded = Math.max(-lower, Math.min(props.duration - upper, delta));
      props.onMoveKeys(initial.map(value => ({ id: value.id, time: snap(value.time + bounded) })));
    };
    const end = () => { props.onGestureEnd(); control.removeEventListener("pointermove", move); control.removeEventListener("pointerup", end); control.removeEventListener("pointercancel", end); };
    control.addEventListener("pointermove", move); control.addEventListener("pointerup", end, { once: true }); control.addEventListener("pointercancel", end, { once: true });
  }
  const major = zoom < .7 ? 2 : zoom > 2 ? .5 : 1;
  const ticks = Array.from({ length: Math.floor(props.duration / major) + 1 }, (_, index) => index * major);
  return <section className="as-timeline" aria-label="Временная шкала анимации" style={{ height }}>
    <button className="as-timeline-grip" aria-label="Изменить высоту Timeline" title="Потяни для изменения высоты" onPointerDown={resize}><GripHorizontal size={16} /></button>
    <div className="as-transport"><div className="as-play-buttons"><button aria-label="В начало анимации" onClick={() => props.onTime(props.range[0])}><SkipBack size={15} /></button><button className="as-play" aria-label={props.playing ? "Остановить воспроизведение" : "Воспроизвести анимацию"} title="Пробел" onClick={props.onPlay}>{props.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}</button><button aria-label="В конец анимации" onClick={() => props.onTime(props.range[1])}><SkipForward size={15} /></button><button aria-label="Зациклить анимацию" aria-pressed={props.loop} className={props.loop ? "is-active" : ""} onClick={() => props.onLoop(!props.loop)}><Repeat2 size={15} /></button></div><label className="as-time-display"><input aria-label="Текущее время анимации" type="number" min={0} max={props.duration} step={1 / props.fps} value={Number(props.time.toFixed(3))} onChange={event => props.onTime(snap(Number(event.target.value) || 0))} /><span>с / {Math.round(props.time * props.fps)} кадр</span></label><label className="as-compact-select"><select aria-label="Скорость воспроизведения" value={props.speed} onChange={event => props.onSpeed(Number(event.target.value))}>{[.25, .5, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label><span className="as-transport-divider" /><button className="as-key-action" onClick={props.onAddKey} title="K"><Diamond size={13} />Ключ</button><div className="as-key-tools"><button aria-label="Копировать ключи" title="Копировать ключи" disabled={!props.selectedKeys.length} onClick={props.onCopyKeys}><Copy size={13} /></button><button aria-label="Вставить ключи" title="Вставить ключи" onClick={props.onPasteKeys}><Scissors size={13} /></button><button aria-label="Дублировать ключи" title="Дублировать ключи" disabled={!props.selectedKeys.length} onClick={props.onDuplicateKeys}><Plus size={13} /></button><button aria-label="Удалить выбранные ключи" title="Удалить ключи" disabled={!props.selectedKeys.length} onClick={props.onDeleteKeys}><Trash2 size={13} /></button></div><div className="as-timeline-settings"><label><span>FPS</span><select aria-label="Частота кадров" value={props.fps} onChange={event => props.onFps(Number(event.target.value) as 24 | 30 | 60)}>{[24, 30, 60].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label><span>Длина</span><input aria-label="Длительность анимации" type="number" min={.5} max={300} step={.5} value={props.duration} onChange={event => props.onDuration(Math.max(.5, Math.min(300, Number(event.target.value) || .5)))} /><span>с</span></label><button aria-label="Уменьшить масштаб Timeline" disabled={zoom <= .3} onClick={() => setZoom(value => Math.max(.3, value / 1.3))}><Minus size={13} /></button><button aria-label="Увеличить масштаб Timeline" disabled={zoom >= 5} onClick={() => setZoom(value => Math.min(5, value * 1.3))}><Plus size={13} /></button></div></div>
    <div className="as-timeline-scroll" ref={scroll}><div className="as-timeline-content" style={{ minWidth: width + 170 }}><div className="as-timeline-ruler"><span className="as-track-label">ДОРОЖКИ<span>{keys.length} ключей</span></span><div className="as-ruler-area" style={{ width }} onPointerDown={scrub}>{ticks.map(value => <span key={value} style={{ left: value * scale }}>{value.toFixed(major < 1 ? 1 : 0)} с</span>)}<i className="as-ruler-cursor" style={{ left: props.time * scale }} /></div></div>{groups.map(({ object, tracks }) => <div key={object.id} className={`as-track-group ${props.selectedObjectId === object.id ? "is-selected" : ""}`}><div className="as-track-object"><button className="as-track-label" onClick={() => { props.onSelectObject(object.id); setCollapsed(previous => previous.includes(object.id) ? previous.filter(value => value !== object.id) : [...previous, object.id]); }}>{collapsed.includes(object.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}<span>{object.name}</span><small>{tracks.length}</small></button><div className="as-track-object-line" style={{ width, backgroundSize: `${scale * major}px 100%` }} onPointerDown={scrub}>{object.audio && <svg className={`as-timeline-waveform ${object.audio.muted ? "is-muted" : ""}`} preserveAspectRatio="none" viewBox={`${object.audio.trimStart / object.audio.duration * 256} 0 ${Math.max(.01, object.audio.trimEnd - object.audio.trimStart) / object.audio.duration * 256} 55`} aria-label={`Звуковая волна: ${object.name}`} style={{ left: object.audio.offset * scale, width: Math.max(1, (object.audio.trimEnd - object.audio.trimStart) * scale) }}>{object.audio.peaks.map((peak, index) => <path key={index} d={`M${index} ${27 - peak * 25}V${27 + peak * 25}`} stroke="currentColor" />)}</svg>}<i className="as-track-playhead" style={{ left: props.time * scale }} /></div></div>{!collapsed.includes(object.id) && !object.audio && (tracks.length ? tracks.map(track => <div className={`as-track-row ${track.muted ? "is-muted" : ""}`} key={track.id}><button className="as-track-label as-track-property" onClick={() => props.onSelectObject(object.id, track.property)}><Diamond size={10} /><span>{propertyName(track.property)}</span></button><div className="as-track-key-area" style={{ width, backgroundSize: `${scale * major}px 100%` }} onPointerDown={scrub}>{track.keyframes.map(key => <button className={`as-keyframe ${props.selectedKeys.includes(key.id) ? "is-selected" : ""}`} key={key.id} aria-label={`Ключ ${object.name}, ${propertyName(track.property)}, ${key.time.toFixed(2)} секунды`} title={`${propertyName(track.property)} · ${key.time.toFixed(3)} с`} style={{ left: key.time * scale }} disabled={track.locked} onPointerDown={event => dragKey(event, key)}><Diamond size={11} fill="currentColor" /></button>)}<i className="as-track-playhead" style={{ left: props.time * scale }} /></div></div>) : <div className="as-track-empty"><span className="as-track-label">Пока без ключей</span><button style={{ width }} onClick={() => { props.onSelectObject(object.id); props.onAddKey(); }}>Выбери часть тела и добавь первый ключ</button></div>)}</div>)}</div></div>
    <div className="as-range-bar"><span>Участок</span><input type="number" aria-label="Начало участка воспроизведения" min={0} max={props.range[1]} step={1 / props.fps} value={Number(props.range[0].toFixed(3))} onChange={event => props.onRange([snap(Number(event.target.value)), props.range[1]])} /><span>—</span><input type="number" aria-label="Конец участка воспроизведения" min={props.range[0]} max={props.duration} step={1 / props.fps} value={Number(props.range[1].toFixed(3))} onChange={event => props.onRange([props.range[0], snap(Number(event.target.value))])} /><span>с</span><button disabled={props.selectedKeys.length < 2} onClick={() => props.onStretchKeys(2)}>Ключи ×2</button><button disabled={props.selectedKeys.length < 2} onClick={() => props.onStretchKeys(.5)}>Ключи ×½</button><span className="as-range-hint">Shift + клик — несколько ключей · Перетаскивай ромбы</span></div>
  </section>;
}

export type { TimelineTrack };
