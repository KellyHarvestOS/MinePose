"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createPlayer, makeDefaultSkin, orientHeldModel, skinTexture } from "./minecraft-scene";
import { loadItemModel } from "@/lib/item-geometry";
import { createStudioEnvironment } from "@/lib/animation-renderer-environment";
import { evaluateProject, type AnimationProject, type AnimationSelection, type AnimationView, type StudioObject, type Transform, type Vec3 } from "@/lib/animation";
import type { BodyPart } from "@/lib/types";
import "./animation-viewport.css";

export type AnimationViewportHandle = {
  setTime: (time: number) => void;
  captureFrame: (time: number, width: number, height: number, transparent: boolean) => Promise<HTMLCanvasElement>;
  getCanvas: () => HTMLCanvasElement | null;
  fitSelection: () => void;
  resetCamera: () => void;
  getWorldTransform: (id: string, part?: BodyPart) => Transform | undefined;
  waitReady: () => Promise<void>;
};
type Props = {
  project: AnimationProject;
  time: number;
  selection: AnimationSelection | null;
  view: AnimationView;
  finalPreview?: boolean;
  onSelect: (selection: AnimationSelection | null) => void;
  onTransform: (selection: AnimationSelection, transform: Transform) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  onReady?: (ready: boolean, error?: string) => void;
};
type Player = ReturnType<typeof createPlayer>;
type Node = {
  root: THREE.Group;
  content: THREE.Group;
  signature: string;
  ready: boolean;
  error: string;
  revision: number;
  player?: Player;
  materials: Map<THREE.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>;
  camera?: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  helper?: THREE.Object3D;
  light?: THREE.Light;
  target?: THREE.Object3D;
  particle?: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  last: StudioObject;
};
type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  world: THREE.Group;
  helpers: THREE.Group;
  environment?: THREE.Group;
  environmentKey: string;
  environmentRevision: number;
  environmentError: string;
  nodes: Map<string, Node>;
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  orbit: OrbitControls;
  gizmo: TransformControls;
  gizmoHelper: THREE.Object3D;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  selectionBox: THREE.BoxHelper;
  ambient: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  pending: Set<Promise<unknown>>;
  statusKey: string;
  projectId: string;
  disposed: boolean;
  dragging: boolean;
  time: number;
  width: number;
  height: number;
  viewKey: string;
  selectionKey: string;
  frameCameraId?: string;
  needsInitialFit: boolean;
};
const BODY_PARTS: BodyPart[] = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"];
const degrees = (rotation: THREE.Euler): Vec3 => ({ x: THREE.MathUtils.radToDeg(rotation.x), y: THREE.MathUtils.radToDeg(rotation.y), z: THREE.MathUtils.radToDeg(rotation.z) });
const vector = (value: THREE.Vector3): Vec3 => ({ x: value.x, y: value.y, z: value.z });
const euler = (value: Vec3) => new THREE.Euler(THREE.MathUtils.degToRad(value.x), THREE.MathUtils.degToRad(value.y), THREE.MathUtils.degToRad(value.z));

function disposeStudioObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse(child => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments) && !(child instanceof THREE.Line) && !(child instanceof THREE.Points)) return;
    geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      for (const value of Object.values(material.userData)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose()); textures.forEach(value => value.dispose());
}

function effectivelyVisible(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) { if (!current.visible) return false; current = current.parent; }
  return true;
}

function image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const source = new Image(); source.onload = () => resolve(source); source.onerror = () => reject(new Error("Не удалось загрузить изображение персонажа")); source.src = url; });
}

function particleTexture(kind: string) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d")!; context.fillStyle = "#ffffff";
  if (kind === "hearts") {
    const rows = ["  XX XX  ", " XXXXXXX ", "XXXXXXXXX", " XXXXXXX ", "  XXXXX  ", "   XXX   ", "    X    "];
    rows.forEach((row, y) => [...row].forEach((pixel, x) => { if (pixel === "X") context.fillRect(x + 3, y + 4, 1, 1); }));
  } else if (kind === "stars" || kind === "magic" || kind === "sparks") {
    context.fillRect(7, 1, 2, 14); context.fillRect(1, 7, 14, 2); context.fillRect(4, 4, 8, 8);
  } else { context.fillRect(4, 4, 8, 8); }
  const texture = new THREE.CanvasTexture(canvas); texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; return texture;
}

function random(seed: number, index: number) { const value = Math.sin((seed + 1) * 43.73 + index * 91.137) * 43758.5453; return value - Math.floor(value); }

function updateParticles(node: Node, object: StudioObject, time: number) {
  if (!node.particle || !object.emitter) return;
  const config = object.emitter, age = time - config.start, duration = Math.max(.01, config.duration);
  node.particle.visible = age >= 0 && age <= duration;
  const count = Math.max(0, Math.min(2000, Math.round(config.count))), points = node.particle.geometry.getAttribute("position") as THREE.BufferAttribute;
  node.particle.geometry.setDrawRange(0, count); node.particle.material.size = config.size; node.particle.material.color.set(config.color);
  for (let index = 0; index < count; index++) {
    const a = random(config.seed, index * 3), b = random(config.seed, index * 3 + 1), c = random(config.seed, index * 3 + 2);
    const phase = (Math.max(0, age) * config.speed + a * 2) % 2, theta = b * Math.PI * 2;
    let x = (a - .5) * 1.5, y = phase, z = (c - .5) * 1.5;
    if (config.kind === "rain" || config.kind === "snow") { x = (a - .5) * 7; z = (c - .5) * 7; y = 4 - phase * 2; if (config.kind === "snow") x += Math.sin(age + b * 8) * .25; }
    else if (config.kind === "explosion") { const distance = Math.max(0, age) * config.speed * 3; x = Math.cos(theta) * distance * (c + .2); y = (b - .3) * distance; z = Math.sin(theta) * distance * (c + .2); }
    else if (config.kind === "portal" || config.kind === "magic" || config.kind === "stars") { const angle = theta + age * config.speed; x = Math.cos(angle) * (.5 + c); z = Math.sin(angle) * (.5 + c); y = phase; }
    else if (config.kind === "fire" || config.kind === "smoke") { x *= .5 + phase * .25; z *= .5 + phase * .25; y = phase * 1.4; }
    else if (config.kind === "hearts") { x = Math.sin(age + a * 6) * .45; z *= .5; y = phase * 1.1; }
    else if (config.kind === "trail") { x = -phase * 1.5; y = (b - .5) * .3; z = (c - .5) * .3; }
    points.setXYZ(index, x, y, z);
  }
  points.needsUpdate = true;
}

function resourceSignature(object: StudioObject) {
  if (object.type === "character") return JSON.stringify([object.type, object.character?.skin, object.character?.slim, object.character?.cape]);
  if (object.type === "item") return JSON.stringify([object.type, object.item?.catalogId, object.item?.hand]);
  if (object.type === "camera") return JSON.stringify([object.type, object.camera?.projection]);
  if (object.type === "light") return JSON.stringify([object.type, object.light?.kind]);
  if (object.type === "particle") return JSON.stringify([object.type, object.emitter?.kind]);
  if (object.type === "model") return JSON.stringify([object.type, object.model?.dataUrl]);
  return object.type;
}

function rememberMaterials(node: Node) {
  node.materials.clear();
  node.content.traverse(child => { if (child instanceof THREE.Mesh || child instanceof THREE.Points) for (const material of Array.isArray(child.material) ? child.material : [child.material]) node.materials.set(material, { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite }); });
}

async function buildNodeContent(object: StudioObject, node: Node) {
  if (object.type === "character") {
    if (!object.character) throw new Error("В проекте отсутствуют настройки персонажа");
    const source = object.character.skin ? await image(object.character.skin) : makeDefaultSkin();
    if (source.width !== 64 || ![32, 64].includes(source.height)) throw new Error("Скин должен быть PNG 64 × 64 или 64 × 32");
    const loaded = skinTexture(source), player = createPlayer(loaded.texture, object.character.slim, loaded.legacy, false);
    player.model.traverse(child => { if (child instanceof THREE.Mesh && child.userData.part && child.material instanceof THREE.MeshStandardMaterial && child.material.transparent) child.userData.studioOuter = true; });
    player.model.scale.setScalar(.5); player.sword.visible = false; node.content.add(player.model); node.player = player;
    if (object.character.cape) {
      const capeImage = await image(object.character.cape), map = new THREE.Texture(capeImage); map.needsUpdate = true; map.magFilter = map.minFilter = THREE.NearestFilter; map.colorSpace = THREE.SRGBColorSpace;
      const cape = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2, .06), new THREE.MeshStandardMaterial({ map, alphaTest: .1, roughness: 1 })); cape.position.set(0, .4, -.32); cape.rotation.x = .1; cape.castShadow = true; player.parts.body.add(cape);
    }
  } else if (object.type === "item") {
    if (!object.item) throw new Error("Не указан предмет");
    const model = await loadItemModel(object.item.catalogId); node.content.add(object.item.hand ? orientHeldModel(model, object.item.hand) : model);
  } else if (object.type === "camera") {
    const camera = object.camera?.projection === "orthographic" ? new THREE.OrthographicCamera(-3, 3, 3, -3, .05, 200) : new THREE.PerspectiveCamera(object.camera?.fov || 40, 1, .05, 200);
    node.camera = camera; node.content.add(camera); node.helper = new THREE.CameraHelper(camera);
  } else if (object.type === "light") {
    const config = object.light;
    if (!config) throw new Error("Не указан источник света");
    const light = config.kind === "ambient" ? new THREE.AmbientLight(config.color, config.intensity) : config.kind === "point" ? new THREE.PointLight(config.color, config.intensity, config.distance) : config.kind === "spot" ? new THREE.SpotLight(config.color, config.intensity, config.distance, THREE.MathUtils.degToRad(config.angle)) : new THREE.DirectionalLight(config.color, config.intensity);
    light.castShadow = config.castShadow; node.light = light; node.content.add(light);
    if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) { node.target = new THREE.Object3D(); light.target = node.target; }
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(.12), new THREE.MeshBasicMaterial({ color: config.color, wireframe: true })); node.helper = marker;
  } else if (object.type === "particle") {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(2000 * 3), 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: object.emitter?.color || "#c395ff", size: object.emitter?.size || .08, map: particleTexture(object.emitter?.kind || "dust"), transparent: true, alphaTest: .1, depthWrite: false })); points.frustumCulled = false; node.content.add(points); node.particle = points;
  } else if (object.type === "model") {
    if (!object.model?.dataUrl) throw new Error("В проекте отсутствует GLB-модель");
    const response = await fetch(object.model.dataUrl), bytes = await response.arrayBuffer();
    if (new DataView(bytes).getUint32(0, true) !== 0x46546c67) throw new Error("Поддерживается встроенная двоичная GLB-модель");
    const manager = new THREE.LoadingManager(); manager.setURLModifier(url => { if (/^(data:|blob:)/i.test(url)) return url; throw new Error("GLB-модель должна содержать все текстуры и данные внутри файла"); });
    const loaded = await new GLTFLoader(manager).parseAsync(bytes, ""); node.content.add(loaded.scene);
  }
  node.root.userData.studioId = node.root.userData.ownerId = object.id;
  node.content.traverse(child => { if (!child.userData.studioId) child.userData.studioId = child.userData.ownerId = object.id; });
  if (node.helper) node.helper.traverse(child => { child.userData.studioId = child.userData.ownerId = object.id; });
  rememberMaterials(node);
}

function makeNode(object: StudioObject): Node {
  const root = new THREE.Group(), content = new THREE.Group(); root.add(content); root.name = object.name;
  return { root, content, signature: resourceSignature(object), ready: false, error: "", revision: 0, materials: new Map(), last: object };
}

const AnimationViewport = forwardRef<AnimationViewportHandle, Props>(function AnimationViewport({ project, time, selection, view, finalPreview = false, onSelect, onTransform, onGestureStart, onGestureEnd, onReady }, forwardedRef) {
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), stage = useRef<Stage | null>(null);
  const props = useRef({ project, time, selection, view, finalPreview, onSelect, onTransform, onGestureStart, onGestureEnd, onReady });
  props.current = { project, time, selection, view, finalPreview, onSelect, onTransform, onGestureStart, onGestureEnd, onReady };
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [status, setStatus] = useState("Загрузка 3D-сцены…");
  const [failed, setFailed] = useState(false);

  function report(s: Stage) {
    if (s.disposed) return;
    const error = s.environmentError || [...s.nodes.values()].find(node => node.error)?.error || "";
    const ready = !error && s.pending.size === 0 && [...s.nodes.values()].every(node => node.ready);
    if (ready && s.needsInitialFit) { s.needsInitialFit = false; focus(s, false); }
    const key = `${ready}:${error}`;
    if (s.statusKey !== key) { s.statusKey = key; setStatus(error || (ready ? "" : "Загрузка 3D-сцены…")); props.current.onReady?.(ready, error || undefined); }
  }

  function watch(s: Stage, promise: Promise<unknown>) {
    s.pending.add(promise); report(s);
    void promise.finally(() => { s.pending.delete(promise); if (!s.disposed) { apply(s, s.time); report(s); } }).catch(() => {});
  }

  function removeNode(s: Stage, node: Node) {
    if (s.gizmo.object && (s.gizmo.object === node.root || node.root.getObjectById(s.gizmo.object.id))) s.gizmo.detach();
    for (const candidate of s.nodes.values()) if (candidate !== node && node.root.getObjectById(candidate.root.id)) s.world.add(candidate.root);
    node.revision++; node.root.removeFromParent();
    if (node.helper) { node.helper.removeFromParent(); disposeStudioObject(node.helper); }
    node.target?.removeFromParent();
    if (node.light && "shadow" in node.light) (node.light as THREE.DirectionalLight).shadow?.map?.dispose();
    disposeStudioObject(node.root);
  }

  function reconcile(s: Stage) {
    const current = props.current.project, ids = new Set(current.objects.map(object => object.id));
    if (s.projectId !== current.id) { s.projectId = current.id; s.time = props.current.time; s.needsInitialFit = true; s.viewKey = ""; }
    for (const [id, node] of s.nodes) if (!ids.has(id)) { removeNode(s, node); s.nodes.delete(id); }
    for (const object of current.objects) {
      let node = s.nodes.get(object.id);
      const signature = resourceSignature(object);
      if (node && node.signature !== signature) { removeNode(s, node); s.nodes.delete(object.id); node = undefined; }
      if (!node) {
        node = makeNode(object); s.nodes.set(object.id, node); s.world.add(node.root);
        const local = node, revision = ++local.revision;
        const pending = buildNodeContent(object, local).then(() => {
          if (s.disposed || s.nodes.get(object.id) !== local || local.revision !== revision) { disposeStudioObject(local.root); if (local.helper) disposeStudioObject(local.helper); return; }
          local.ready = true; if (local.helper) s.helpers.add(local.helper); if (local.target) s.scene.add(local.target);
        }).catch(error => { if (!s.disposed && s.nodes.get(object.id) === local) local.error = error instanceof Error ? error.message : "Не удалось загрузить объект"; });
        watch(s, pending);
      }
      node.last = object;
    }
    const environmentKey = JSON.stringify([current.scene.environment, current.scene.floor, current.scene.floorSize, current.scene.shadows]);
    if (s.environmentKey !== environmentKey) {
      s.environmentKey = environmentKey; s.environmentError = "";
      const revision = ++s.environmentRevision;
      const pending = createStudioEnvironment(current.scene).then(environment => {
        if (s.disposed || s.environmentRevision !== revision) { disposeStudioObject(environment); return; }
        if (s.environment) { s.environment.removeFromParent(); disposeStudioObject(s.environment); }
        s.environment = environment; s.scene.add(environment);
      }).catch(error => { if (!s.disposed && s.environmentRevision === revision) s.environmentError = error instanceof Error ? error.message : "Не удалось загрузить окружение"; });
      watch(s, pending);
    }
    apply(s, s.time); report(s);
  }

  function sourceCamera(s: Stage, source: StudioObject, width: number, height: number) {
    const node = s.nodes.get(source.id), config = source.camera;
    if (!node?.camera || !config) return null;
    const camera = node.camera;
    if (camera instanceof THREE.PerspectiveCamera) { camera.fov = config.fov; camera.aspect = width / height; }
    else { const half = 3 / Math.max(.05, config.zoom); camera.left = -half * width / height; camera.right = half * width / height; camera.top = half; camera.bottom = -half; }
    camera.zoom = camera instanceof THREE.PerspectiveCamera ? config.zoom : 1;
    const position = node.content.getWorldPosition(new THREE.Vector3());
    const targetNode = config.followId ? s.nodes.get(config.followId) : undefined;
    const target = targetNode ? targetNode.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1, 0)) : new THREE.Vector3(config.target.x, config.target.y, config.target.z);
    const worldRotation = node.root.getWorldQuaternion(new THREE.Quaternion());
    const desired = new THREE.PerspectiveCamera(); desired.position.copy(position); desired.lookAt(target); desired.quaternion.multiply(worldRotation);
    camera.position.set(0, 0, 0);
    const parentQuaternion = node.content.getWorldQuaternion(new THREE.Quaternion()); camera.quaternion.copy(parentQuaternion.invert().multiply(desired.quaternion));
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    if (node.helper instanceof THREE.CameraHelper) node.helper.update();
    return camera;
  }

  function apply(s: Stage, at: number, exporting = false) {
    if (s.disposed) return;
    s.time = Math.max(0, Math.min(props.current.project.duration, at));
    const current = props.current.project, evaluated = evaluateProject(current, s.time), byId = new Map(evaluated.map(object => [object.id, object]));
    const finalPreview = props.current.finalPreview && !exporting, cleanView = exporting || finalPreview;
    for (const object of evaluated) {
      const node = s.nodes.get(object.id); if (!node) continue;
      node.last = object;
      const parent = object.parentId ? s.nodes.get(object.parentId) : undefined;
      let host: THREE.Object3D = s.world;
      if (parent && parent !== node) {
        if (object.attachment && parent.player) {
          host = object.attachment === "root" ? parent.player.model : object.attachment === "back" ? parent.player.parts.body : parent.player.parts[object.attachment];
        } else host = parent.root;
        let ancestor: THREE.Object3D | null = host;
        while (ancestor) { if (ancestor === node.root) { host = s.world; break; } ancestor = ancestor.parent; }
      }
      if (node.root.parent !== host) host.add(node.root);
      const { position, rotation, scale } = object.transform;
      const arm = parent?.player && (object.attachment === "leftArm" || object.attachment === "rightArm");
      node.root.position.set(position.x, position.y + (arm ? -1.25 : object.attachment === "back" ? .9 : 0), position.z + (arm ? .1 : object.attachment === "back" ? -.35 : 0));
      node.root.rotation.copy(euler(rotation)); node.root.scale.set(scale.x, scale.y, scale.z); node.content.position.set(-object.pivot.x, -object.pivot.y, -object.pivot.z); node.root.visible = object.visible && object.type !== "audio";
      for (const [material, baseline] of node.materials) { material.opacity = baseline.opacity * object.opacity; material.transparent = baseline.transparent || object.opacity < 1; material.depthWrite = object.opacity < 1 ? false : baseline.depthWrite; }
      if (node.player && object.character) {
        for (const part of BODY_PARTS) {
          node.player.parts[part].rotation.copy(euler(object.character.pose[part]));
          for (const child of node.player.parts[part].children) {
            if (child.userData.outline) child.visible = false;
            else if (child.userData.studioOuter && child.userData.part === part) child.visible = object.character.outer[part];
          }
        }
      }
      if (node.light && object.light) {
        node.light.color.set(object.light.color); node.light.intensity = object.visible ? object.light.intensity : 0; node.light.castShadow = current.scene.shadows && object.light.castShadow;
        if (node.light instanceof THREE.PointLight || node.light instanceof THREE.SpotLight) node.light.distance = object.light.distance;
        if (node.light instanceof THREE.SpotLight) node.light.angle = THREE.MathUtils.degToRad(object.light.angle);
        node.target?.position.set(object.light.target.x, object.light.target.y, object.light.target.z);
      }
      if (node.particle) updateParticles(node, object, s.time);
    }
    s.scene.updateMatrixWorld(true);
    for (const object of evaluated) if (object.camera) sourceCamera(s, object, s.width, s.height);
    s.ambient.intensity = current.scene.ambient; s.renderer.shadowMap.enabled = current.scene.shadows;
    const transparent = finalPreview ? current.export.transparent && ["gif", "png", "png-sequence"].includes(current.export.format) : current.scene.transparent;
    s.scene.background = transparent ? null : new THREE.Color(current.scene.background);
    if (s.environment) s.environment.visible = !(finalPreview && transparent);
    s.grid.visible = !cleanView && props.current.view.showGrid; s.axes.visible = !cleanView && props.current.view.showAxes; s.helpers.visible = !cleanView;
    for (const [id, node] of s.nodes) if (node.helper) { node.helper.visible = !cleanView && effectivelyVisible(node.root); if (!(node.helper instanceof THREE.CameraHelper)) node.root.getWorldPosition(node.helper.position); node.helper.userData.studioId = id; }
    const view = props.current.view, key = JSON.stringify([view.projection, view.view, view.cameraId, view.quality]);
    if (key !== s.viewKey) { s.viewKey = key; configureView(s, view); }
    let camera = s.camera;
    const cameraId = cleanView ? current.export.cameraId || current.scene.activeCameraId : view.view === "camera" ? view.cameraId || current.scene.activeCameraId : undefined;
    if (cameraId) { const object = byId.get(cameraId); if (object?.camera) camera = sourceCamera(s, object, finalPreview ? current.export.width : s.width, finalPreview ? current.export.height : s.height) || camera; }
    s.frameCameraId = cameraId;
    if (!exporting) {
      const selected = props.current.selection, node = selected ? s.nodes.get(selected.objectId) : undefined;
      const target = node && selected?.part && node.player ? node.player.parts[selected.part] : node?.root;
      const locked = node?.last.locked || Boolean(selected?.part && node?.last.character?.lockedParts.includes(selected.part));
      if (target && node?.ready && !locked && !cameraId && !finalPreview) {
        s.gizmo.setMode(selected?.part ? "rotate" : view.mode); s.gizmo.setSpace(view.space); s.gizmo.setTranslationSnap(view.snap ? .25 : null); s.gizmo.setRotationSnap(view.snap ? Math.PI / 12 : null); s.gizmo.setScaleSnap(view.snap ? .1 : null);
        if (s.gizmo.object !== target) s.gizmo.attach(target);
        s.selectionBox.visible = true; s.selectionBox.setFromObject(target);
      } else { s.gizmo.detach(); s.selectionBox.visible = false; }
      s.gizmo.camera = camera;
      s.orbit.enabled = !s.dragging && !cameraId && !finalPreview;
    }
    s.renderer.render(s.scene, camera);
  }

  function focus(s: Stage, onlySelection: boolean) {
    const bounds = new THREE.Box3();
    const selected = onlySelection && props.current.selection ? s.nodes.get(props.current.selection.objectId) : undefined;
    if (selected) bounds.setFromObject(selected.root);
    else for (const node of s.nodes.values()) if (node.last.visible && ["character", "item", "model"].includes(node.last.type)) bounds.union(new THREE.Box3().setFromObject(node.root));
    if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const center = bounds.getCenter(new THREE.Vector3()), size = Math.max(2, bounds.getSize(new THREE.Vector3()).length());
    s.orbit.target.copy(center); s.camera.position.copy(center).add(new THREE.Vector3(1, .65, 1.5).normalize().multiplyScalar(size * 1.4));
    if (s.camera instanceof THREE.OrthographicCamera) { s.camera.zoom = 3 / Math.max(1, size * .45); s.camera.updateProjectionMatrix(); }
    s.orbit.update(); apply(s, s.time);
  }

  function configureView(s: Stage, view: AnimationView) {
    const next = view.projection === "orthographic" ? s.orthographic : s.perspective;
    if (next !== s.camera) { next.position.copy(s.camera.position); next.quaternion.copy(s.camera.quaternion); s.camera = next; s.orbit.object = next; }
    const target = s.orbit.target, distance = Math.max(3, s.camera.position.distanceTo(target));
    const directions: Partial<Record<AnimationView["view"], THREE.Vector3>> = { front: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(0, 0, -1), left: new THREE.Vector3(-1, 0, 0), right: new THREE.Vector3(1, 0, 0), top: new THREE.Vector3(0, 1, .0001) };
    const direction = directions[view.view];
    if (direction) { s.camera.position.copy(target).addScaledVector(direction, distance); s.camera.up.set(0, 1, 0); s.camera.lookAt(target); s.orbit.update(); }
    const ratio = s.width / s.height; s.perspective.aspect = ratio; s.perspective.updateProjectionMatrix(); s.orthographic.left = -3 * ratio; s.orthographic.right = 3 * ratio; s.orthographic.updateProjectionMatrix();
    const quality = view.quality === "low" ? 1 : Math.min(window.devicePixelRatio || 1, view.quality === "high" ? 2 : 1.5); s.renderer.setPixelRatio(quality); s.renderer.setSize(s.width, s.height, false);
  }

  async function waitReady(s: Stage) {
    while (s.pending.size) await Promise.allSettled([...s.pending]);
    if (s.disposed) throw new Error("3D-сцена закрыта");
    const error = s.environmentError || [...s.nodes.values()].find(node => node.error)?.error;
    if (error) throw new Error(error);
    if ([...s.nodes.values()].some(node => !node.ready)) throw new Error("Модели ещё загружаются");
  }

  useImperativeHandle(forwardedRef, () => ({
    setTime(value) { if (stage.current) apply(stage.current, value); },
    getCanvas() { return stage.current?.renderer.domElement || null; },
    fitSelection() { if (stage.current) focus(stage.current, true); },
    resetCamera() { if (stage.current) focus(stage.current, false); },
    getWorldTransform(id, part) {
      const node = stage.current?.nodes.get(id), object = node && part && node.player ? node.player.parts[part] : node?.root;
      if (!object) return undefined;
      object.updateWorldMatrix(true, false); const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(); object.matrixWorld.decompose(position, rotation, scale);
      return { position: vector(position), rotation: degrees(new THREE.Euler().setFromQuaternion(rotation)), scale: vector(scale) };
    },
    async waitReady() { if (!stage.current) throw new Error("Для 3D-редактора нужен WebGL"); await waitReady(stage.current); },
    async captureFrame(at, width, height, transparent) {
      const s = stage.current; if (!s) throw new Error("3D-сцена недоступна");
      await waitReady(s);
      if (![width, height].every(value => Number.isInteger(value) && value >= 16 && value <= 8192)) throw new Error("Размер кадра должен быть целым числом от 16 до 8192 пикселей");
      const gl = s.renderer.getContext(), maximum = Math.min(s.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      if (width > maximum || height > maximum) throw new Error(`Этот браузер поддерживает кадры до ${maximum} пикселей по каждой стороне`);
      const time = s.time, oldWidth = s.width, oldHeight = s.height, ratio = s.renderer.getPixelRatio(), background = s.scene.background, environmentVisible = s.environment?.visible;
      const perspectiveAspect = s.perspective.aspect, ortho = { left: s.orthographic.left, right: s.orthographic.right, top: s.orthographic.top, bottom: s.orthographic.bottom };
      try {
        s.width = width; s.height = height; s.renderer.setPixelRatio(1); s.renderer.setSize(width, height, false); s.perspective.aspect = width / height; s.perspective.updateProjectionMatrix(); s.orthographic.left = -3 * width / height; s.orthographic.right = 3 * width / height; s.orthographic.updateProjectionMatrix();
        apply(s, at, true);
        s.scene.background = transparent ? null : new THREE.Color(props.current.project.scene.background); if (transparent && s.environment) s.environment.visible = false;
        const cameraObject = props.current.project.objects.find(object => object.id === (props.current.project.export.cameraId || props.current.project.scene.activeCameraId)); const camera = cameraObject ? sourceCamera(s, evaluateProject(props.current.project, at).find(object => object.id === cameraObject.id)!, width, height) : s.camera; s.renderer.render(s.scene, camera || s.camera);
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); if (!context) throw new Error("Не удалось подготовить кадр"); context.drawImage(s.renderer.domElement, 0, 0); return canvas;
      } finally {
        s.width = oldWidth; s.height = oldHeight; s.renderer.setPixelRatio(ratio); s.renderer.setSize(oldWidth, oldHeight, false); s.perspective.aspect = perspectiveAspect; s.perspective.updateProjectionMatrix(); Object.assign(s.orthographic, ortho); s.orthographic.updateProjectionMatrix(); s.scene.background = background; if (s.environment && environmentVisible !== undefined) s.environment.visible = environmentVisible; apply(s, time);
      }
    },
  }));

  useEffect(() => {
    const container = host.current; if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }); }
    catch { setFailed(true); setStatus("Для Animation Studio нужен WebGL. Включите аппаратное ускорение в браузере."); props.current.onReady?.(false, "WebGL недоступен"); return; }
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0, 0); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none"; renderer.domElement.setAttribute("aria-label", "3D-сцена Animation Studio. Перетаскивайте для вращения, колесо — масштаб."); renderer.domElement.tabIndex = 0; container.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), world = new THREE.Group(), helpers = new THREE.Group(); scene.add(world, helpers);
    const perspective = new THREE.PerspectiveCamera(40, 1, .05, 300), orthographic = new THREE.OrthographicCamera(-3, 3, 3, -3, .05, 300); perspective.position.set(5, 3.5, 7); orthographic.position.copy(perspective.position);
    const orbit = new OrbitControls(perspective, renderer.domElement); orbit.target.set(0, 1, 0); orbit.minDistance = .25; orbit.maxDistance = 150; orbit.enableDamping = false; orbit.update();
    const gizmo = new TransformControls(perspective, renderer.domElement); gizmo.setSize(.8); const gizmoHelper = gizmo.getHelper(); helpers.add(gizmoHelper);
    const grid = new THREE.GridHelper(100, 100, "#65516f", "#342e3b"); grid.position.y = .002; const axes = new THREE.AxesHelper(2); helpers.add(grid, axes);
    const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), "#c395ff"); selectionBox.visible = false; helpers.add(selectionBox);
    const ambient = new THREE.HemisphereLight("#e7d9f5", "#3c3446", props.current.project.scene.ambient), sun = new THREE.DirectionalLight("#fff0d8", 2.4); sun.position.set(-4, 8, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -15; sun.shadow.camera.right = sun.shadow.camera.top = 15; sun.shadow.normalBias = .025; scene.add(ambient, sun);
    const s: Stage = { renderer, scene, world, helpers, environmentKey: "", environmentRevision: 0, environmentError: "", nodes: new Map(), perspective, orthographic, camera: perspective, orbit, gizmo, gizmoHelper, grid, axes, selectionBox, ambient, sun, pending: new Set(), statusKey: "", projectId: props.current.project.id, disposed: false, dragging: false, time: props.current.time, width: 1, height: 1, viewKey: "", selectionKey: "", needsInitialFit: true };
    stage.current = s; setFailed(false);
    const render = () => { if (!s.disposed) apply(s, s.time); };
    const resize = () => { if (s.disposed || !container.isConnected) return; const { width, height } = container.getBoundingClientRect(); if (!width || !height) return; s.width = width; s.height = height; s.viewKey = ""; render(); };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    orbit.addEventListener("change", render);
    const dragging = (event: { value?: unknown }) => { s.dragging = Boolean(event.value); orbit.enabled = !s.dragging; if (s.dragging) props.current.onGestureStart?.(); else props.current.onGestureEnd?.(); };
    const changed = () => {
      const selection = props.current.selection, object = gizmo.object;
      if (!selection || !object || !s.dragging) return;
      const transform = { position: vector(object.position), rotation: degrees(object.rotation), scale: vector(object.scale) };
      const source = s.nodes.get(selection.objectId)?.last;
      if (!selection.part && source?.parentId && (source.attachment === "leftArm" || source.attachment === "rightArm")) { transform.position.y += 1.25; transform.position.z -= .1; }
      if (!selection.part && source?.attachment === "back") { transform.position.y -= .9; transform.position.z += .35; }
      props.current.onTransform(selection, transform);
      s.scene.updateMatrixWorld(true); s.renderer.render(s.scene, s.camera);
    };
    gizmo.addEventListener("dragging-changed", dragging); gizmo.addEventListener("objectChange", changed);
    const raycaster = new THREE.Raycaster(); let down = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
    const pointerUp = (event: PointerEvent) => {
      if (props.current.finalPreview) return;
      if (s.dragging || gizmo.axis || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect(), pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const cameraObject = evaluateProject(props.current.project, s.time).find(object => object.id === s.frameCameraId); const camera = cameraObject ? sourceCamera(s, cameraObject, s.width, s.height) : s.camera;
      raycaster.setFromCamera(pointer, camera || s.camera);
      const hit = raycaster.intersectObjects<THREE.Object3D>([...[...s.nodes.values()].map(node => node.root), ...[...s.nodes.values()].flatMap(node => node.helper ? [node.helper] : [])], true).find(hit => hit.object.userData.studioId && effectivelyVisible(hit.object) && !hit.object.userData.outline && !s.nodes.get(hit.object.userData.studioId)?.last.locked);
      props.current.onSelect(hit ? { objectId: hit.object.userData.studioId, part: hit.object.userData.part as BodyPart | undefined } : null);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown); renderer.domElement.addEventListener("pointerup", pointerUp);
    reconcile(s);
    return () => { s.disposed = true; observer.disconnect(); gizmo.detach(); gizmo.removeEventListener("dragging-changed", dragging); gizmo.removeEventListener("objectChange", changed); gizmo.dispose(); orbit.removeEventListener("change", render); orbit.dispose(); renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); for (const node of s.nodes.values()) removeNode(s, node); s.nodes.clear(); if (s.environment) { s.environment.removeFromParent(); disposeStudioObject(s.environment); } disposeStudioObject(helpers); sun.shadow.map?.dispose(); renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); if (stage.current === s) stage.current = null; };
  }, []);

  useEffect(() => { if (stage.current) reconcile(stage.current); }, [project]);
  useEffect(() => { if (stage.current) apply(stage.current, time); }, [time, selection, view, finalPreview]);
  useEffect(() => {
    const element = frame.current;
    if (!element || !finalPreview) { setFrameSize(null); return; }
    const resize = () => { const bounds = element.getBoundingClientRect(), aspect = project.export.width / project.export.height; const width = Math.min(bounds.width, bounds.height * aspect), height = width / aspect; setFrameSize({ width, height }); };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, [finalPreview, project.export.width, project.export.height]);

  return <div className={`av-viewport ${finalPreview ? "is-final-preview" : ""}`} ref={frame} data-ready={!status && !failed} data-export-camera={finalPreview ? project.export.cameraId || project.scene.activeCameraId : undefined}><div className="av-canvas" ref={host} style={finalPreview && frameSize ? { width: frameSize.width, height: frameSize.height } : undefined} />{status ? <div className={`av-status ${failed ? "is-error" : ""}`} role={failed ? "alert" : "status"}>{status}</div> : null}</div>;
});

export default AnimationViewport;
