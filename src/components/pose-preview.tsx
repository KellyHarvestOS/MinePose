"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { LoaderCircle } from "lucide-react";
import { createPlayer, disposeObject, makeDefaultSkin, orientHeldModel, skinTexture } from "./minecraft-scene";
import { disposeItemModel, loadItemModel } from "@/lib/item-geometry";
import { applyRigPose, contactShadow, fitModelCamera } from "@/lib/pose-rendering";
import { presetScene, type PosePreset } from "@/lib/pose-presets";
import "./pose-preview.css";

type Props = { preset: PosePreset; skin: string; slim: boolean; className?: string };
type PreviewJob = { promise: Promise<string>; consumers: Set<symbol>; state: "queued" | "running" | "done" | "cancelled" };
const previewCache = new Map<string, PreviewJob>();
const skinCache = new Map<string, Promise<HTMLImageElement>>();
let renderer: THREE.WebGLRenderer | undefined;
let rig: { key: string; player: ReturnType<typeof createPlayer>; texture: THREE.Texture } | undefined;
let queue: Promise<unknown> = Promise.resolve();
let users = 0;

function loadSkin(url: string) {
  let image = skinCache.get(url);
  if (!image) {
    image = new Promise<HTMLImageElement>((resolve, reject) => {
      const source = new Image();
      source.onload = () => source.naturalWidth === 64 && [32, 64].includes(source.naturalHeight) ? resolve(source) : reject(new Error("Неверный размер скина"));
      source.onerror = () => reject(new Error("Не удалось загрузить скин"));
      source.src = url;
    });
    skinCache.set(url, image);
    image.catch(() => skinCache.delete(url));
    while (skinCache.size > 3) skinCache.delete(skinCache.keys().next().value!);
  }
  return image;
}

function disposeRig() {
  if (!rig) return;
  rig.player.model.removeFromParent(); disposeObject(rig.player.model); rig.texture.dispose(); rig = undefined;
}

async function renderPreview(preset: PosePreset, skin: string, slim: boolean, width: number, height: number, wanted: () => boolean) {
  renderer ??= new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf1e7fa, 0x4c4059, 2.5));
  const key = new THREE.DirectionalLight(0xffeed8, 2.8); key.position.set(-4, 7, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb9a8df, 1.6); rim.position.set(4, 3, -4); scene.add(rim);
  const settings = presetScene(preset, skin, slim);
  const keySkin = `${slim}:${skin}`;
  if (rig?.key !== keySkin) {
    const loadedSkin = skinTexture(skin ? await loadSkin(skin) : makeDefaultSkin());
    if (!wanted()) { loadedSkin.texture.dispose(); throw new Error("Отменённое превью"); }
    disposeRig();
    rig = { key: keySkin, player: createPlayer(loadedSkin.texture, slim, loadedSkin.legacy, false), texture: loadedSkin.texture };
  }
  const player = rig!.player;
  const itemRoots: THREE.Group[] = [];
  player.sword.visible = false;
  scene.add(player.model);
  try {
    applyRigPose(player.model, player.parts, preset.pose, settings);
    for (const hand of ["right", "left"] as const) {
      const entry = preset.items[hand];
      if (!entry) continue;
      const model = orientHeldModel(await loadItemModel(entry.id), hand);
      const root = new THREE.Group();
      const { position, rotation, scale } = entry.transform;
      root.position.set(position.x, -1.25 + position.y, .1 + position.z);
      root.rotation.set(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z));
      root.scale.setScalar(scale); root.add(model);
      player.parts[hand === "right" ? "rightArm" : "leftArm"].add(root);
      itemRoots.push(root);
    }
    if (!wanted()) throw new Error("Отменённое превью");
    scene.add(contactShadow(player.model));
    const camera = new THREE.PerspectiveCamera(29, width / height, .05, 100);
    fitModelCamera(camera, player.model, preset.camera);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  } finally {
    for (const item of itemRoots) { item.removeFromParent(); disposeItemModel(item); }
    player.model.removeFromParent(); disposeObject(scene); renderer.renderLists.dispose();
  }
}

function requestPreview(preset: PosePreset, skin: string, slim: boolean, width: number, height: number) {
  const key = `${skin}:${slim}:${width}x${height}:${JSON.stringify(preset)}`;
  const consumer = Symbol();
  const cached = previewCache.get(key);
  const release = (job: PreviewJob) => {
    job.consumers.delete(consumer);
    if (!job.consumers.size && job.state === "queued") {
      job.state = "cancelled";
      if (previewCache.get(key) === job) previewCache.delete(key);
    }
  };
  if (cached && cached.state !== "cancelled") {
    cached.consumers.add(consumer); previewCache.delete(key); previewCache.set(key, cached);
    return { promise: cached.promise, release: () => release(cached) };
  }
  const job: PreviewJob = { promise: Promise.resolve(""), consumers: new Set([consumer]), state: "queued" };
  const pending = queue.then(async () => {
    if (!users || !job.consumers.size || job.state === "cancelled") throw new Error("Отменённое превью");
    job.state = "running";
    const result = await renderPreview(preset, skin, slim, width, height, () => users > 0 && job.consumers.size > 0);
    job.state = "done"; return result;
  });
  job.promise = pending;
  queue = pending.catch(() => undefined);
  previewCache.set(key, job);
  pending.catch(() => { if (previewCache.get(key) === job) previewCache.delete(key); });
  while (previewCache.size > 36) previewCache.delete(previewCache.keys().next().value!);
  return { promise: pending, release: () => release(job) };
}

function releaseRenderer() {
  void queue.finally(() => {
    if (users || !renderer) return;
    disposeRig(); renderer.dispose(); renderer.forceContextLoss(); renderer = undefined;
  });
}

export default function PosePreview({ preset, skin, slim, className = "" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    users++;
    return () => { users--; if (!users) releaseRenderer(); };
  }, []);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const resize = () => {
      if (!container.isConnected) return;
      const { width, height } = container.getBoundingClientRect();
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2, 640 / width, 640 / height);
      const next = { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!size.width || !size.height) return;
    let active = true;
    setStatus("loading");
    const request = requestPreview(preset, skin, slim, size.width, size.height);
    void request.promise.then(url => {
      if (!active) return;
      const image = new Image();
      image.onload = () => {
        if (!active || !canvas.current) return;
        const context = canvas.current.getContext("2d");
        if (!context) { setStatus("error"); return; }
        context.clearRect(0, 0, size.width, size.height); context.drawImage(image, 0, 0); setStatus("ready");
      };
      image.onerror = () => { if (active) setStatus("error"); };
      image.src = url;
    }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; request.release(); };
  }, [preset, skin, slim, size.width, size.height]);
  return <div ref={host} className={`pose-preview ${className}`} data-preset-id={preset.id} data-preview-ready={status === "ready"} aria-busy={status === "loading"}><canvas ref={canvas} width={size.width || 1} height={size.height || 1} role="img" aria-label={`3D-превью: ${preset.name}`} style={{ display: "block", width: "100%", height: "100%", opacity: status === "ready" ? 1 : 0 }} />{status !== "ready" && <span className={status === "error" ? "pp-error" : "pp-loading"} role={status === "error" ? "alert" : "status"} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: 16, textAlign: "center", fontSize: 11, color: "#9f94ad" }}>{status === "loading" ? <><LoaderCircle size={15} />Собираем позу…</> : "Не удалось загрузить 3D-превью"}</span>}</div>;
}
