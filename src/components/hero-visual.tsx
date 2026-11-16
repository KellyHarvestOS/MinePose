"use client";

import { useMemo, useRef, useState } from "react";
import { Box, LoaderCircle, RotateCcw } from "lucide-react";
import MinecraftScene, { type MinecraftSceneHandle } from "./minecraft-scene";
import { PRESETS, presetScene } from "@/lib/pose-presets";
import "./hero-visual.css";

type Props = { skin: string; slim: boolean; reduced: boolean };

export default function HeroVisual({ skin, slim, reduced }: Props) {
  const sceneRef = useRef<MinecraftSceneHandle>(null);
  const [ready, setReady] = useState(false);
  const [itemsReady, setItemsReady] = useState(false);
  const [error, setError] = useState("");
  const settings = useMemo(() => ({ ...presetScene(PRESETS[0], skin, slim), background: "transparent", floor: false, grid: false, light: 1.15 }), [skin, slim]);
  return <div className="hv-visual" aria-label="Предпросмотр Minecraft-сцены">
    <div className="hv-stage-header"><span><Box size={13} />3D-сцена<span className="hv-status-dot" /></span><button aria-label="Сбросить ракурс сцены" title="Вернуть исходный ракурс" disabled={!ready || !itemsReady} onClick={() => sceneRef.current?.resetCamera()}><RotateCcw size={14} /></button></div>
    <MinecraftScene ref={sceneRef} pose={PRESETS[0].pose} settings={settings} hero interactive={!reduced} className="hv-scene hero-scene" onReady={setReady} onItemsReady={(value, message) => { setItemsReady(value); setError(message || ""); }} />
    {(!ready || !itemsReady) && !error && <span className="hv-loading" role="status"><LoaderCircle size={13} />Собираем сцену…</span>}
    {error && <span className="hv-loading hv-error" role="alert">{error}</span>}
    <i className="hv-corner hv-corner-tl" /><i className="hv-corner hv-corner-tr" /><i className="hv-corner hv-corner-bl" /><i className="hv-corner hv-corner-br" />
    <div className="hv-stage-footer"><span>{reduced ? "Твой персонаж в центре истории" : "Потяни, чтобы повернуть"}</span><span className="hv-skin-status"><i />{skin ? "Твой скин" : "Путешественник"}</span></div>
  </div>;
}
