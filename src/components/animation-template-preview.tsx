"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { createPlayer, makeDefaultSkin, orientHeldModel, skinTexture } from "./minecraft-scene";
import { loadItemModel } from "@/lib/item-geometry";
import { createStudioEnvironment } from "@/lib/animation-renderer-environment";
import { BODY_PARTS, createAnimationProject, evaluateProject, type AnimationProject, type AnimationTemplate, type StudioObject, type Vec3 } from "@/lib/animation";
import { visibleModelBounds } from "@/lib/pose-rendering";
import "./animation-template-preview.css";

type Props = { template: AnimationTemplate; skin: string; slim: boolean; playing?: boolean; time?: number; className?: string; onReady?: (ready: boolean, error?: string) => void };
type Player = ReturnType<typeof createPlayer>;
type PreviewNode = { root: THREE.Group; content: THREE.Group; player?: Player; light?: THREE.Light; target?: THREE.Object3D; materials: Map<THREE.Material, { opacity: number; transparent: boolean }> };
type PreviewScene = { project: AnimationProject; template: AnimationTemplate; scene: THREE.Scene; world: THREE.Group; nodes: Map<string, PreviewNode>; camera: THREE.PerspectiveCamera; environment: THREE.Group; motionBounds: THREE.Box3; fittedAspect: number; fitPosition: THREE.Vector3; fitTarget: THREE.Vector3 };
type PreviewEntry = { canvas: HTMLCanvasElement; template: AnimationTemplate; skin: string; slim: boolean; visible: boolean; disposed: boolean; queued: boolean; ready: boolean; error: string; dirty: boolean; playing: boolean; controlledTime?: number; time: number; lastStamp: number; lastRender: number; width: number; height: number; frame: number; stage?: PreviewScene; onState: (ready: boolean, error?: string) => void };

const entries = new Set<PreviewEntry>();
const skinImages = new Map<string, Promise<HTMLImageElement>>();
const posterTimes: Record<AnimationTemplate, number> = { empty: 0, walk: .72, combat: .82, dance: .78, cinematic: 1, gif: .7 };
let renderer: THREE.WebGLRenderer | undefined;
let rendererError = "";
let frameRequest = 0;
let buildQueue: Promise<unknown> = Promise.resolve();
let media: MediaQueryList | undefined;
let reducedMotion = false;

const angle = (value: Vec3) => new THREE.Euler(THREE.MathUtils.degToRad(value.x), THREE.MathUtils.degToRad(value.y), THREE.MathUtils.degToRad(value.z), "XYZ");

function disposeScene(scene: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Points) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of [...Object.values(material), ...Object.values(material.userData)]) if (value instanceof THREE.Texture) textures.add(value);
        if (material instanceof THREE.ShaderMaterial) for (const uniform of Object.values(material.uniforms)) if (uniform.value instanceof THREE.Texture) textures.add(uniform.value);
      }
    }
    if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight || object instanceof THREE.SpotLight) object.shadow.dispose();
  });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
  scene.clear();
}

function loadSkin(url: string) {
  let pending = skinImages.get(url);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth === 64 && [32, 64].includes(image.naturalHeight) ? resolve(image) : reject(new Error("Скин должен иметь размер 64 × 64 или 64 × 32"));
      image.onerror = () => reject(new Error("Не удалось загрузить скин для 3D-превью")); image.src = url;
    });
    skinImages.set(url, pending); pending.catch(() => { if (skinImages.get(url) === pending) skinImages.delete(url); });
    while (skinImages.size > 4) skinImages.delete(skinImages.keys().next().value!);
  }
  return pending;
}

function getRenderer() {
  if (rendererError) throw new Error(rendererError);
  if (!renderer) {
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
      renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0, 0);
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
    } catch { rendererError = "Для 3D-превью включите WebGL и аппаратное ускорение браузера"; throw new Error(rendererError); }
  }
  return renderer;
}

function contextLost(event: Event) {
  event.preventDefault(); rendererError = "3D-превью приостановлено: браузер потерял графический контекст";
  for (const entry of entries) { entry.error = rendererError; entry.onState(false, rendererError); }
  if (frameRequest) cancelAnimationFrame(frameRequest); frameRequest = 0;
}

async function makeScene(entry: PreviewEntry): Promise<PreviewScene> {
  const project = createAnimationProject(entry.template, entry.skin, entry.slim), scene = new THREE.Scene(), world = new THREE.Group();
  scene.add(world);
  const nodes = new Map<string, PreviewNode>();
  try {
    const environment = await createStudioEnvironment({ environment: project.scene.environment, floor: project.scene.floor && !project.scene.transparent, floorSize: project.scene.floorSize, shadows: true });
    scene.add(environment);
    if (entry.disposed) throw new Error("Отменённое 3D-превью");
    const hemisphere = new THREE.HemisphereLight("#e9dff5", "#4a3b59", 1.85); scene.add(hemisphere);
    const fill = new THREE.DirectionalLight("#c9b6ed", 1.5); fill.position.set(4, 3, -4); scene.add(fill);
    for (const object of project.objects) {
      if (entry.disposed) throw new Error("Отменённое 3D-превью");
      if (!["character", "item", "group", "light"].includes(object.type)) continue;
      const root = new THREE.Group(), content = new THREE.Group(); root.add(content); world.add(root);
      const node: PreviewNode = { root, content, materials: new Map() }; nodes.set(object.id, node);
      if (object.character) {
        const source = object.character.skin ? await loadSkin(object.character.skin) : makeDefaultSkin();
        if (entry.disposed) throw new Error("Отменённое 3D-превью");
        const loaded = skinTexture(source), player = createPlayer(loaded.texture, object.character.slim, loaded.legacy, false);
        player.model.scale.setScalar(.5); player.sword.visible = false;
        player.model.traverse(child => { if (child.userData.outline) child.visible = false; if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial && child.material.transparent) child.userData.previewOuter = true; });
        content.add(player.model); node.player = player;
      } else if (object.item) {
        const model = await loadItemModel(object.item.catalogId); content.add(object.item.hand ? orientHeldModel(model, object.item.hand) : model);
      } else if (object.light) {
        const config = object.light;
        const light = config.kind === "ambient" ? new THREE.AmbientLight(config.color, config.intensity) : config.kind === "point" ? new THREE.PointLight(config.color, config.intensity, config.distance) : config.kind === "spot" ? new THREE.SpotLight(config.color, config.intensity, config.distance, THREE.MathUtils.degToRad(config.angle)) : new THREE.DirectionalLight(config.color, config.intensity);
        light.castShadow = config.castShadow; content.add(light); node.light = light;
        if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) { const target = new THREE.Object3D(); scene.add(target); light.target = target; node.target = target; light.shadow.mapSize.set(512, 512); light.shadow.normalBias = .025; }
        if (light instanceof THREE.DirectionalLight) { light.shadow.camera.left = light.shadow.camera.bottom = -6; light.shadow.camera.right = light.shadow.camera.top = 6; }
      }
      content.traverse(child => { if (child instanceof THREE.Mesh) for (const material of Array.isArray(child.material) ? child.material : [child.material]) node.materials.set(material, { opacity: material.opacity, transparent: material.transparent }); });
    }
    const camera = new THREE.PerspectiveCamera(34, entry.width / entry.height, .05, 100);
    const stage: PreviewScene = { project, template: entry.template, scene, world, nodes, camera, environment, motionBounds: new THREE.Box3(), fittedAspect: 0, fitPosition: new THREE.Vector3(), fitTarget: new THREE.Vector3() };
    const samples = new Set([...Array.from({ length: 25 }, (_, index) => project.duration * index / 24), ...project.tracks.flatMap(track => track.keyframes.map(key => key.time))]);
    for (const time of samples) { applyObjects(stage, time); stage.motionBounds.union(visibleModelBounds(world)); }
    applyObjects(stage, entry.time);
    return stage;
  } catch (error) { disposeScene(scene); throw error; }
}

function applyObjects(stage: PreviewScene, time: number) {
  const objects = evaluateProject(stage.project, time);
  for (const object of objects) {
    const node = stage.nodes.get(object.id); if (!node) continue;
    const parent = object.parentId ? stage.nodes.get(object.parentId) : undefined;
    let host: THREE.Object3D = stage.world;
    if (parent) host = object.attachment && parent.player ? object.attachment === "root" ? parent.player.model : object.attachment === "back" ? parent.player.parts.body : parent.player.parts[object.attachment] : parent.root;
    if (node.root.parent !== host) host.add(node.root);
    const arm = parent?.player && (object.attachment === "leftArm" || object.attachment === "rightArm"), transform = object.transform;
    node.root.position.set(transform.position.x, transform.position.y + (arm ? -1.25 : object.attachment === "back" ? .9 : 0), transform.position.z + (arm ? .1 : object.attachment === "back" ? -.35 : 0));
    node.root.rotation.copy(angle(transform.rotation)); node.root.scale.set(transform.scale.x, transform.scale.y, transform.scale.z); node.content.position.set(-object.pivot.x, -object.pivot.y, -object.pivot.z); node.root.visible = object.visible;
    for (const [material, baseline] of node.materials) { material.opacity = baseline.opacity * object.opacity; material.transparent = baseline.transparent || object.opacity < 1; }
    if (node.player && object.character) for (const part of BODY_PARTS) {
      node.player.parts[part].rotation.copy(angle(object.character.pose[part]));
      for (const child of node.player.parts[part].children) if (child.userData.previewOuter && child.userData.part === part) child.visible = object.character.outer[part];
    }
    if (node.light && object.light) { node.light.intensity = object.light.intensity; node.light.color.set(object.light.color); node.target?.position.set(object.light.target.x, object.light.target.y, object.light.target.z); }
  }
  stage.scene.updateMatrixWorld(true);
  return objects;
}

function fitCamera(stage: PreviewScene, width: number, height: number) {
  const aspect = width / height;
  if (Math.abs(stage.fittedAspect - aspect) < .0001) return;
  const camera = stage.camera, bounds = stage.motionBounds.clone();
  camera.aspect = aspect;
  const direction = stage.template === "combat" ? { azimuth: 23, elevation: 14 } : stage.template === "gif" ? { azimuth: 22, elevation: 8 } : { azimuth: 24, elevation: 10 };
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-.7, 0, -.7), new THREE.Vector3(.7, 2, .7));
  if (bounds.min.y > .12) bounds.min.y = 0;
  const target = bounds.getCenter(new THREE.Vector3()), azimuth = THREE.MathUtils.degToRad(direction.azimuth), elevation = THREE.MathUtils.degToRad(direction.elevation);
  const view = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
  camera.position.copy(target).add(view); camera.lookAt(target); camera.updateMatrixWorld(true);
  const inverse = camera.quaternion.clone().invert(), tangentY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tangentX = tangentY * Math.max(.1, aspect);
  let distance = 1;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).sub(target).applyQuaternion(inverse);
    distance = Math.max(distance, point.z + Math.abs(point.x) / tangentX, point.z + Math.abs(point.y) / tangentY);
  }
  camera.position.copy(target).addScaledVector(view, distance * 1.15); camera.near = .05; camera.far = Math.max(100, distance * 5); camera.lookAt(target);
  stage.fitTarget.copy(target); stage.fitPosition.copy(camera.position); stage.fittedAspect = aspect; camera.updateProjectionMatrix();
}

function render(entry: PreviewEntry) {
  const stage = entry.stage; if (!stage || entry.disposed || !entry.visible) return;
  const output = getRenderer(), time = Math.max(0, Math.min(stage.project.duration, entry.controlledTime ?? entry.time));
  const evaluated = applyObjects(stage, time);
  fitCamera(stage, entry.width, entry.height);
  const camera = stage.camera;
  camera.position.copy(stage.fitPosition); camera.lookAt(stage.fitTarget);
  if (stage.template === "cinematic") {
    const current = evaluated.find(object => object.id === (stage.project.export.cameraId || stage.project.scene.activeCameraId));
    if (current?.camera) {
      const target = new THREE.Vector3(current.camera.target.x, current.camera.target.y, current.camera.target.z);
      const direction = new THREE.Vector3(current.transform.position.x, current.transform.position.y, current.transform.position.z).sub(target).normalize();
      const distance = stage.fitPosition.distanceTo(stage.fitTarget) * 1.15;
      camera.position.copy(stage.fitTarget).addScaledVector(direction, distance); camera.lookAt(stage.fitTarget); camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(angle(current.transform.rotation)));
    }
  }
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  stage.scene.background = stage.project.scene.transparent ? null : new THREE.Color("#201929");
  output.setSize(entry.width, entry.height, false); output.render(stage.scene, camera);
  const context = entry.canvas.getContext("2d"); if (!context) throw new Error("Браузер не разрешил создать 3D-превью");
  if (entry.canvas.width !== entry.width || entry.canvas.height !== entry.height) { entry.canvas.width = entry.width; entry.canvas.height = entry.height; }
  context.clearRect(0, 0, entry.width, entry.height); context.drawImage(output.domElement, 0, 0);
  entry.frame++; entry.canvas.dataset.frame = String(entry.frame); entry.canvas.dataset.time = time.toFixed(4); entry.canvas.dataset.characters = String(stage.project.objects.filter(object => object.character).length); entry.canvas.dataset.items = String(stage.project.objects.filter(object => object.item).length);
  if (!entry.ready) { entry.ready = true; entry.onState(true); }
  entry.dirty = false;
}

function tick(stamp: number) {
  frameRequest = 0;
  if (document.hidden || !entries.size) return;
  let continuing = false;
  for (const entry of entries) {
    if (entry.disposed || !entry.visible || !entry.stage || entry.error) continue;
    const animating = entry.playing && entry.controlledTime === undefined && !reducedMotion && entry.stage.project.tracks.length > 0;
    if (animating) { if (entry.lastStamp) entry.time = (entry.time + Math.min(.15, (stamp - entry.lastStamp) / 1000)) % entry.stage.project.duration; continuing = true; }
    entry.lastStamp = stamp;
    if ((entry.dirty || animating) && (entry.dirty || stamp - entry.lastRender >= 1000 / 24)) {
      try { render(entry); entry.lastRender = stamp; }
      catch (failure) { entry.error = failure instanceof Error ? failure.message : "Не удалось отрисовать 3D-превью"; entry.onState(false, entry.error); }
    }
  }
  if (continuing) wake();
}

function wake() { if (!frameRequest && entries.size && !document.hidden) frameRequest = requestAnimationFrame(tick); }

function enqueue(entry: PreviewEntry) {
  if (entry.queued || entry.disposed || !entry.visible) return;
  entry.queued = true;
  const pending = buildQueue.then(async () => {
    if (entry.disposed) return;
    try {
      getRenderer(); const stage = await makeScene(entry);
      if (entry.disposed) { disposeScene(stage.scene); return; }
      entry.stage = stage; entry.dirty = true; wake();
    } catch (failure) { if (!entry.disposed) { entry.error = failure instanceof Error ? failure.message : "Не удалось загрузить 3D-превью"; entry.onState(false, entry.error); } }
  });
  buildQueue = pending.catch(() => undefined);
}

function visibility() {
  if (document.hidden) { if (frameRequest) cancelAnimationFrame(frameRequest); frameRequest = 0; return; }
  for (const entry of entries) { entry.lastStamp = 0; entry.dirty = true; } wake();
}

function motionPreference(event: MediaQueryListEvent) { reducedMotion = event.matches; for (const entry of entries) { entry.lastStamp = 0; entry.dirty = true; } wake(); }

function register(entry: PreviewEntry) {
  if (!entries.size) { media = window.matchMedia("(prefers-reduced-motion: reduce)"); reducedMotion = media.matches; media.addEventListener("change", motionPreference); document.addEventListener("visibilitychange", visibility); }
  entries.add(entry);
}

function release(entry: PreviewEntry) {
  entry.disposed = true; entries.delete(entry);
  if (entry.stage) { disposeScene(entry.stage.scene); entry.stage = undefined; }
  if (entries.size) return;
  if (frameRequest) cancelAnimationFrame(frameRequest); frameRequest = 0;
  document.removeEventListener("visibilitychange", visibility); media?.removeEventListener("change", motionPreference); media = undefined;
  if (renderer) { renderer.domElement.removeEventListener("webglcontextlost", contextLost); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer = undefined; }
  rendererError = ""; skinImages.clear();
}

export default function AnimationTemplatePreview({ template, skin, slim, playing = false, time, className = "", onReady }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null), entryRef = useRef<PreviewEntry | null>(null);
  const callback = useRef(onReady); callback.current = onReady;
  const options = useRef({ playing, time }); options.current = { playing, time };
  const [ready, setReady] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const target = canvas.current, container = host.current; if (!target || !container) return;
    setReady(false); setError(""); callback.current?.(false);
    const entry: PreviewEntry = { canvas: target, template, skin, slim, visible: false, disposed: false, queued: false, ready: false, error: "", dirty: true, playing: options.current.playing, controlledTime: options.current.time, time: options.current.time ?? posterTimes[template], lastStamp: 0, lastRender: 0, width: 480, height: 300, frame: 0, onState: (value, message) => { if (entry.disposed) return; setReady(value); setError(message || ""); callback.current?.(value, message); } };
    entryRef.current = entry; register(entry);
    const size = () => {
      const bounds = container.getBoundingClientRect(); if (bounds.width < 1 || bounds.height < 1) return;
      const ratio = Math.min(1.5, window.devicePixelRatio || 1), scale = Math.min(1, 800 / (bounds.width * ratio), 500 / (bounds.height * ratio));
      const width = Math.max(16, Math.round(bounds.width * ratio * scale)), height = Math.max(16, Math.round(bounds.height * ratio * scale));
      if (entry.width !== width || entry.height !== height) { entry.width = width; entry.height = height; entry.dirty = true; wake(); }
    };
    size(); const resize = new ResizeObserver(size); resize.observe(container);
    const intersection = new IntersectionObserver(values => { const value = values[0]; entry.visible = value.isIntersecting; entry.lastStamp = 0; if (entry.visible) { entry.dirty = true; enqueue(entry); wake(); } }, { rootMargin: "80px" }); intersection.observe(container);
    return () => { resize.disconnect(); intersection.disconnect(); release(entry); if (entryRef.current === entry) entryRef.current = null; };
  }, [template, skin, slim]);
  useEffect(() => { const entry = entryRef.current; if (!entry) return; entry.playing = playing; entry.controlledTime = time; entry.lastStamp = 0; entry.dirty = true; wake(); }, [playing, time]);
  return <div ref={host} className={`atp-preview ${template === "gif" ? "has-transparent-background" : ""} ${className}`} data-template={template} data-ready={ready} data-error={error || undefined}><canvas ref={canvas} aria-label={`3D-превью шаблона ${template}`} data-template={template} data-frame="0" data-time="0" />{!ready && !error && <span className="atp-status" role="status"><LoaderCircle size={16} className="animate-spin" /><span>Загружаем 3D-сцену</span></span>}{error && <span className="atp-status atp-error" role="status"><AlertCircle size={18} /><span>{error}</span></span>}</div>;
}
