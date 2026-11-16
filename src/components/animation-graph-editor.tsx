"use client";

import { useRef, type PointerEvent } from "react";
import { easingProgress } from "@/lib/animation";

export type GraphEasing = "step" | "linear" | "easeIn" | "easeOut" | "easeInOut" | "bezier";
type Props = { easing: GraphEasing; bezier?: [number, number, number, number]; onChange: (easing: GraphEasing, bezier?: [number, number, number, number]) => void; onGestureStart: () => void; onGestureEnd: () => void };
export default function AnimationGraphEditor({ easing, bezier = [.25, .1, .25, 1], onChange, onGestureStart, onGestureEnd }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const curve = easing === "step" ? "M 20 160 H 220 V 20" : Array.from({ length: 61 }, (_, index) => `${index ? "L" : "M"}${20 + index / 60 * 200} ${160 - easingProgress(index / 60, easing, bezier) * 140}`).join(" ");
  function drag(event: PointerEvent<SVGCircleElement>, index: 0 | 2) {
    event.currentTarget.setPointerCapture(event.pointerId); onGestureStart();
    const original = [...bezier] as [number, number, number, number];
    const control = event.currentTarget;
    const move = (next: globalThis.PointerEvent) => {
      const box = svg.current?.getBoundingClientRect(); if (!box) return;
      const point = [...original] as [number, number, number, number];
      point[index] = Math.max(0, Math.min(1, ((next.clientX - box.left) / box.width * 240 - 20) / 200));
      point[index + 1] = Math.max(0, Math.min(1, (160 - (next.clientY - box.top) / box.height * 180) / 140));
      onChange("bezier", point);
    };
    const end = () => { onGestureEnd(); control.removeEventListener("pointermove", move); control.removeEventListener("pointerup", end); control.removeEventListener("pointercancel", end); };
    control.addEventListener("pointermove", move); control.addEventListener("pointerup", end, { once: true }); control.addEventListener("pointercancel", end, { once: true });
  }
  return <div className="as-graph-editor"><label>Переход между ключами<select aria-label="Интерполяция ключевого кадра" value={easing} onChange={event => { const value = event.target.value as GraphEasing; const curves: Partial<Record<GraphEasing, [number, number, number, number]>> = { easeIn: [.42, 0, 1, 1], easeOut: [0, 0, .58, 1], easeInOut: [.42, 0, .58, 1] }; onChange(value, curves[value] || bezier); }}><option value="step">Step · Мгновенно</option><option value="linear">Linear · Равномерно</option><option value="easeIn">Ease In · Ускорение</option><option value="easeOut">Ease Out · Замедление</option><option value="easeInOut">Ease In Out · Плавно</option><option value="bezier">Cubic Bezier · Своя кривая</option></select></label><svg ref={svg} viewBox="0 0 240 180" role="img" aria-label="Кривая интерполяции"><path d="M20 20V160H220M20 90H220M120 20V160" fill="none" stroke="#3a3045" strokeWidth={1} /><path d={curve} fill="none" stroke="#c395ff" strokeWidth={2.5} />{easing === "bezier" && <><path d={`M20 160L${20 + bezier[0] * 200} ${160 - bezier[1] * 140}M220 20L${20 + bezier[2] * 200} ${160 - bezier[3] * 140}`} stroke="#826695" /><circle cx={20 + bezier[0] * 200} cy={160 - bezier[1] * 140} r={6} fill="#e2c5fa" onPointerDown={event => drag(event, 0)} /><circle cx={20 + bezier[2] * 200} cy={160 - bezier[3] * 140} r={6} fill="#b184d3" onPointerDown={event => drag(event, 2)} /></>}</svg>{easing === "bezier" && <div className="as-bezier-fields">{bezier.map((value, index) => <label key={index}>{["X₁", "Y₁", "X₂", "Y₂"][index]}<input type="number" aria-label={`Bezier ${["X1", "Y1", "X2", "Y2"][index]}`} min={0} max={1} step={.01} value={Number(value.toFixed(3))} onChange={event => { const next = [...bezier] as [number, number, number, number]; next[index] = Math.max(0, Math.min(1, Number(event.target.value) || 0)); onChange("bezier", next); }} /></label>)}</div>}</div>;
}
