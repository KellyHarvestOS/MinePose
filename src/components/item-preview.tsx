"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { disposeItemModel, loadItemModel } from "@/lib/item-geometry";
import { getItemDefinition } from "@/lib/items";

function lighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xf4edff, 0x4b405c, 2.5));
  const key = new THREE.DirectionalLight(0xfff3dc, 3); key.position.set(-3, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb7a0e6, 1.3); rim.position.set(4, 2, -3); scene.add(rim);
}

// A single offscreen renderer makes the block icons. It never creates one
// WebGL context per catalog entry and releases each temporary item's resources.
const icons = new Map<string, Promise<string>>();
let iconRenderer: THREE.WebGLRenderer | undefined;
let iconQueue: Promise<unknown> = Promise.resolve();
function blockIcon(id: string): Promise<string> {
  if (icons.has(id)) return icons.get(id)!;
  const promise = iconQueue.then(async () => {
    const model = await loadItemModel(id);
    try {
      iconRenderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
      iconRenderer.setSize(80, 80, false); iconRenderer.setClearColor(0, 0); iconRenderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene(); lighting(scene);
      const display = model.userData.display?.gui;
      if (display?.rotation) model.rotation.set(...display.rotation.map((angle: number) => THREE.MathUtils.degToRad(angle)) as [number, number, number]);
      else model.rotation.set(.35, -.65, 0);
      scene.add(model);
      const bounds = new THREE.Box3().setFromObject(model), center = bounds.getCenter(new THREE.Vector3());
      model.position.sub(center);
      const extent = Math.max(...bounds.getSize(new THREE.Vector3()).toArray()) * .72;
      const camera = new THREE.OrthographicCamera(-extent, extent, extent, -extent, .01, 30); camera.position.set(0, 0, 5);
      iconRenderer.render(scene, camera);
      return iconRenderer.domElement.toDataURL("image/png");
    } finally { disposeItemModel(model); }
  });
  iconQueue = promise.catch(() => undefined);
  icons.set(id, promise);
  return promise;
}

export function ItemIcon({ id }: { id: string }) {
  const item = getItemDefinition(id);
  const element = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!item || (item.category !== "blocks" && !item.id.endsWith("_block") && item.id !== "shield")) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void blockIcon(id).then(value => { if (active) setUrl(value); }).catch(() => { /* The original texture remains available as an icon. */ });
    }, { rootMargin: "80px" });
    if (element.current) observer.observe(element.current);
    return () => { active = false; observer.disconnect(); };
  }, [id, item]);
  return <span ref={element} aria-hidden="true" className="ip-item-icon" style={{ display: "inline-block", width: 36, height: 36, flexShrink: 0, backgroundImage: `url("${url || item?.icon || ""}")`, backgroundSize: url ? "contain" : "100% auto", backgroundRepeat: "no-repeat", backgroundPosition: "center top", imageRendering: "pixelated" }} />;
}

export default function ItemPreview({ id, className = "" }: { id: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef<() => void>(() => {});
  const [status, setStatus] = useState("Загрузка модели…");
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    setStatus("Загрузка модели…");
    let active = true;
    let model: THREE.Group | undefined;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch { setStatus("Для 3D-предпросмотра нужен WebGL"); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute("aria-label", "3D-предпросмотр предмета. Перетаскивайте для вращения.");
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); lighting(scene);
    const camera = new THREE.PerspectiveCamera(32, 1, .01, 50);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enablePan = false; controls.minDistance = .5; controls.maxDistance = 12;
    const render = () => renderer.render(scene, camera);
    const resize = () => { const { width, height } = container.getBoundingClientRect(); if (!width || !height) return; renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); };
    const observer = new ResizeObserver(resize); observer.observe(container); controls.addEventListener("change", render); resize();
    void loadItemModel(id).then(value => {
      if (!active) { disposeItemModel(value); return; }
      model = value; scene.add(model);
      const bounds = new THREE.Box3().setFromObject(model), radius = bounds.getSize(new THREE.Vector3()).length() / 2;
      reset.current = () => { controls.target.set(0, 0, 0); camera.position.set(radius * 1.8, radius * 1.15, radius * 3.1); controls.update(); render(); };
      reset.current(); setStatus(""); resize();
    }).catch(() => { if (active) setStatus("Не удалось загрузить модель. Выберите предмет ещё раз."); });
    return () => { active = false; observer.disconnect(); controls.dispose(); if (model) disposeItemModel(model); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); reset.current = () => {}; };
  }, [id]);
  return <div className={`ip-preview ${className}`} style={{ position: "relative", minHeight: 130 }}><div ref={host} className="ip-preview-host" style={{ position: "absolute", inset: 0 }} />{status && <span role="status" className="ip-preview-status" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, textAlign: "center", fontSize: 10, padding: 15, pointerEvents: "none" }}>{status === "Загрузка модели…" && <LoaderCircle size={13} />}{status}</span>}<button className="pe-small-button ip-preview-reset" style={{ position: "absolute", right: 7, bottom: 7 }} aria-label="Сбросить ракурс предмета" onClick={() => reset.current()}><RotateCcw size={13} /></button></div>;
}
