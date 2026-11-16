"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DEFAULT_POSE, DEFAULT_SCENE, PRESETS, type BodyPart, type Pose, type SceneSettings } from "@/lib/types";
import type { AvatarShot } from "@/lib/avatars";
import { emptyItems, type EquippedItems, type Hand } from "@/lib/items";
import { disposeItemModel, loadItemModel } from "@/lib/item-geometry";
import { applyRigPose, fitModelCamera, visibleModelBounds } from "@/lib/pose-rendering";

export type MinecraftSceneHandle = {
  capture: (width?: number, height?: number, transparent?: boolean) => string;
  resetCamera: () => void;
  fitCamera: () => void;
};
type Props = {
  pose?: Pose;
  settings?: SceneSettings;
  interactive?: boolean;
  hero?: boolean;
  avatar?: AvatarShot;
  className?: string;
  onSelectPart?: (part: BodyPart) => void;
  selectedPart?: BodyPart | null;
  onReady?: (ready: boolean) => void;
  onViewChange?: () => void;
  onItemsReady?: (ready: boolean, error?: string) => void;
  autoFrame?: boolean;
  fitKey?: string | number;
};
type ItemSlot = { root: THREE.Group; model?: THREE.Group; id?: string | null; ready: boolean; error: string; revision: number };
type Parts = Record<BodyPart, THREE.Group>;
type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  environment: THREE.Group;
  floor: THREE.Group;
  grid: THREE.GridHelper;
  keyLight: THREE.DirectionalLight;
  model: THREE.Group;
  parts: Parts;
  sword: THREE.Group;
  ready: boolean;
  skin: string;
  slim: boolean;
  avatar?: AvatarShot;
  render: () => void;
  resize: () => void;
  itemSlots: Record<Hand, ItemSlot>;
  itemStatus: string;
  needsFrame: boolean;
  frameKey?: string | number;
  hasUserView: boolean;
  heroWorld?: THREE.Group;
};
const BODY_PARTS: BodyPart[] = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg"];

function handSlots(parts: Parts): Record<Hand, ItemSlot> {
  const slots = {} as Record<Hand, ItemSlot>;
  for (const hand of ["right", "left"] as const) {
    const root = new THREE.Group(); root.name = `held-item-${hand}`;
    parts[hand === "right" ? "rightArm" : "leftArm"].add(root);
    slots[hand] = { root, ready: true, error: "", revision: 0 };
  }
  return slots;
}

export function orientHeldModel(model: THREE.Group, hand: Hand) {
  // Entity renderers use a different origin than inventory JSON models. Their
  // centered geometry needs a palm grip rather than the original entity offset.
  if (model.userData.itemId === "shield") {
    model.scale.setScalar(1.35); model.position.set(0, .18, .38);
    model.rotation.y = hand === "left" ? -.15 : .15;
    return model;
  }
  if (model.userData.itemId === "trident") {
    model.scale.setScalar(1.7); model.position.set(0, .65, .05);
    model.rotation.y = hand === "left" ? -.3 : .3;
    return model;
  }
  const display = model.userData.display?.[`thirdperson_${hand}hand`] || model.userData.display?.thirdperson_righthand;
  if (display) {
    const rotation = display.rotation || [0, 0, 0];
    model.rotation.set(...rotation.map((angle: number) => THREE.MathUtils.degToRad(angle)) as [number, number, number]);
    const scale = display.scale || [1, 1, 1]; model.scale.fromArray(scale).multiplyScalar(1.7);
    const position = display.translation || [0, 0, 0]; model.position.fromArray(position).multiplyScalar(1.7 / 16);
    // The vanilla hand transform rotates item space into the downward arm.
    const basis = new THREE.Group(); basis.rotation.set(Math.PI / 2, Math.PI, 0); basis.add(model);
    return basis;
  }
  model.scale.setScalar(model.userData.kind === "generated" ? 1.5 : 1);
  return model;
}

export function makeDefaultSkin(): HTMLCanvasElement {
  const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
  const c = canvas.getContext("2d")!;
  const noise = (x: number, y: number) => ((x * 37 + y * 71 + x * y * 13) % 17) / 17;
  const block = (x: number, y: number, w: number, h: number, color: string, amount = 0.1) => {
    const base = new THREE.Color(color);
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
      const n = 1 - amount + noise(px, py) * amount * 2;
      c.fillStyle = `#${base.clone().multiplyScalar(n).getHexString()}`; c.fillRect(px, py, 1, 1);
    }
  };
  block(0, 0, 32, 16, "#483027", 0.13);
  block(8, 8, 8, 8, "#dda879", 0.04);
  block(0, 10, 8, 6, "#c28e64", 0.05); block(16, 10, 8, 6, "#bc8b61", 0.05);
  c.fillStyle = "#483027"; c.fillRect(8, 8, 8, 2); c.fillRect(8, 10, 2, 1); c.fillRect(15, 10, 1, 2);
  c.fillStyle = "#f3efe0"; c.fillRect(9, 11, 2, 1); c.fillRect(13, 11, 2, 1);
  c.fillStyle = "#41647d"; c.fillRect(10, 11, 1, 1); c.fillRect(13, 11, 1, 1);
  c.fillStyle = "#ab7557"; c.fillRect(11, 12, 2, 2);
  c.fillStyle = "#644134"; c.fillRect(10, 14, 4, 1); c.fillRect(11, 15, 2, 1);
  block(16, 16, 24, 16, "#68438f", 0.12);
  block(20, 20, 8, 12, "#8755b0", 0.08);
  c.fillStyle = "#e2b85f"; c.fillRect(20, 20, 8, 2); c.fillRect(23, 22, 2, 3);
  c.fillStyle = "#472c63"; c.fillRect(20, 30, 8, 2);
  c.fillStyle = "#b28c51"; c.fillRect(23, 30, 2, 2);
  for (const [x, y] of [[40, 16], [32, 48]]) {
    block(x, y, 16, 16, "#67408b", 0.1);
    block(x, y + 9, 16, 7, "#d3a174", 0.06);
    c.fillStyle = "#3f275c"; c.fillRect(x, y + 7, 16, 2);
    c.fillStyle = "#6e5843"; c.fillRect(x, y + 14, 16, 2);
  }
  for (const [x, y] of [[0, 16], [16, 48]]) {
    block(x, y, 16, 16, "#344753", 0.1);
    block(x, y + 12, 16, 4, "#473b32", 0.12);
    c.fillStyle = "#282823"; c.fillRect(x, y + 15, 16, 1);
  }
  return canvas;
}

export function skinTexture(source: HTMLCanvasElement | HTMLImageElement) {
  const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
  const c = canvas.getContext("2d")!; c.imageSmoothingEnabled = false; c.drawImage(source, 0, 0);
  const legacy = source.height === 32;
  if (legacy) {
    // Old skins have one arm and leg. Bake Minecraft's mirrored left limbs into
    // the modern atlas, swapping the east/west faces as well as flipping pixels.
    const mirrorFace = (sx: number, sy: number, dx: number, dy: number, width: number, height: number) => {
      c.save(); c.translate(dx + width, dy); c.scale(-1, 1);
      c.drawImage(source, sx, sy, width, height, 0, 0, width, height); c.restore();
    };
    const mirrorLimb = (sx: number, sy: number, dx: number, dy: number) => {
      mirrorFace(sx + 4, sy, dx + 4, dy, 4, 4);
      mirrorFace(sx + 8, sy, dx + 8, dy, 4, 4);
      mirrorFace(sx + 8, sy + 4, dx, dy + 4, 4, 12);
      mirrorFace(sx + 4, sy + 4, dx + 4, dy + 4, 4, 12);
      mirrorFace(sx, sy + 4, dx + 8, dy + 4, 4, 12);
      mirrorFace(sx + 12, sy + 4, dx + 12, dy + 4, 4, 12);
    };
    mirrorLimb(0, 16, 16, 48); mirrorLimb(40, 16, 32, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false;
  return { texture, legacy };
}

function skinGeometry(w: number, h: number, d: number, atlasX: number, atlasY: number, expansion = 0) {
  const geometry = new THREE.BoxGeometry(w / 8 + expansion, h / 8 + expansion, d / 8 + expansion);
  const faces = [
    [atlasX + d + w, atlasY + d, d, h], [atlasX, atlasY + d, d, h],
    [atlasX + d, atlasY, w, d], [atlasX + d + w, atlasY, w, d],
    [atlasX + d, atlasY + d, w, h], [atlasX + 2 * d + w, atlasY + d, w, h],
  ];
  const uv = geometry.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const [x, y, width, height] = faces[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const vertical = f === 3 ? uv.getY(i) : 1 - uv.getY(i);
      uv.setXY(i, (x + uv.getX(i) * width) / 64, 1 - (y + vertical * height) / 64);
    }
  }
  uv.needsUpdate = true; return geometry;
}

function buildSword() {
  const group = new THREE.Group();
  const layout = ["       cc", "      cCc", "     cCc ", "    cCc  ", "c  cCc   ", "ccccc    ", " cDc     ", "  D      ", " D       ", "D        "];
  const colors: Record<string, number> = { c: 0x155e60, C: 0x76e4d0, D: 0x68462c };
  for (let y = 0; y < layout.length; y++) for (let x = 0; x < layout[y].length; x++) {
    const color = colors[layout[y][x]]; if (color === undefined) continue;
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.085), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    cube.position.set((x - 2) * 0.11, (8 - y) * 0.11, 0); cube.castShadow = true; group.add(cube);
  }
  group.rotation.set(-Math.PI / 2, 0, -0.4); group.position.set(0, -1.35, 0.25); return group;
}

export function createPlayer(texture: THREE.Texture, slim: boolean, legacy: boolean, withLegacySword = true) {
  const model = new THREE.Group();
  const parts = {} as Parts;
  const torso = new THREE.Group(); torso.position.y = 1.5; model.add(torso); parts.body = torso;
  const armWidth = slim ? 3 : 4;
  const definitions: { id: BodyPart; w: number; h: number; d: number; uv: number[]; overlay: number[]; position: number[]; center: number[]; parent: THREE.Group }[] = [
    { id: "body", w: 8, h: 12, d: 4, uv: [16, 16], overlay: [16, 32], position: [0, 0, 0], center: [0, 0.75, 0], parent: torso },
    { id: "head", w: 8, h: 8, d: 8, uv: [0, 0], overlay: [32, 0], position: [0, 1.5, 0], center: [0, 0.5, 0], parent: torso },
    { id: "rightArm", w: armWidth, h: 12, d: 4, uv: [40, 16], overlay: [40, 32], position: [-(0.5 + armWidth / 16), 1.4, 0], center: [0, -0.65, 0], parent: torso },
    { id: "leftArm", w: armWidth, h: 12, d: 4, uv: [32, 48], overlay: [48, 48], position: [0.5 + armWidth / 16, 1.4, 0], center: [0, -0.65, 0], parent: torso },
    { id: "rightLeg", w: 4, h: 12, d: 4, uv: [0, 16], overlay: [0, 32], position: [-0.25, 1.5, 0], center: [0, -0.75, 0], parent: model },
    { id: "leftLeg", w: 4, h: 12, d: 4, uv: [16, 48], overlay: [0, 48], position: [0.25, 1.5, 0], center: [0, -0.75, 0], parent: model },
  ];
  for (const def of definitions) {
    const part = def.id === "body" ? torso : new THREE.Group();
    if (def.id !== "body") { part.position.fromArray(def.position); def.parent.add(part); parts[def.id] = part; }
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, alphaTest: 0.1 });
    const geometry = skinGeometry(def.w, def.h, def.d, def.uv[0], def.uv[1]);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.fromArray(def.center);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.part = def.id; part.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0xc395ff, depthTest: false }));
    edges.position.copy(mesh.position); edges.scale.setScalar(1.008); edges.visible = false; edges.renderOrder = 5; edges.userData.outline = def.id; part.add(edges);
    if (!legacy || def.id === "head") {
      const layer = new THREE.Mesh(skinGeometry(def.w, def.h, def.d, def.overlay[0], def.overlay[1], def.id === "head" ? 0.07 : 0.035), new THREE.MeshStandardMaterial({ map: texture, transparent: true, alphaTest: 0.1, roughness: 0.85 }));
      layer.position.copy(mesh.position); layer.castShadow = true; layer.userData.part = def.id; part.add(layer);
    }
  }
  const sword = withLegacySword ? buildSword() : new THREE.Group(); parts.rightArm.add(sword);
  return { model, parts, sword };
}

function prepareAvatar(player: ReturnType<typeof createPlayer>, shot?: AvatarShot) {
  if (shot === "head") {
    // The head belongs to the torso group. Keep that parent alive and hide only
    // the actual body meshes, retaining both the head and its outer skin layer.
    player.model.traverse(child => {
      if (child.userData.part && child.userData.part !== "head") child.visible = false;
    });
    player.parts.leftArm.visible = false; player.parts.rightArm.visible = false;
    player.parts.leftLeg.visible = false; player.parts.rightLeg.visible = false;
  } else if (shot === "mini") {
    player.parts.body.position.y = 0.95;
    player.parts.body.scale.set(0.78, 0.72, 0.82);
    player.parts.head.scale.set(1.72, 2, 1.63);
    player.parts.leftArm.scale.y = 0.72; player.parts.rightArm.scale.y = 0.72;
    for (const leg of [player.parts.leftLeg, player.parts.rightLeg]) {
      leg.position.y = 0.95; leg.scale.y = 0.63;
    }
  }
}

function frameCamera(camera: THREE.PerspectiveCamera, controls: OrbitControls, hero: boolean, avatar?: AvatarShot) {
  camera.fov = hero ? 36 : 31;
  camera.position.set(5.8, hero ? 4.5 : 3.6, hero ? 7.2 : 8);
  controls.target.set(0, hero ? 1.25 : 2, 0);
  if (avatar === "portrait") {
    camera.fov = 29; camera.position.set(2.5, 3.72, 5.8); controls.target.set(0, 2.85, 0);
  } else if (avatar === "head") {
    camera.fov = 25; camera.position.set(1.75, 4.18, 4.25); controls.target.set(0, 3.5, 0);
  } else if (avatar === "full") {
    camera.fov = 29; camera.position.set(4.2, 3.2, 8.5); controls.target.set(0, 2, 0);
  } else if (avatar === "mini") {
    camera.fov = 30; camera.position.set(3.25, 2.8, 6.7); controls.target.set(0, 1.75, 0);
  }
  camera.updateProjectionMatrix(); controls.update();
}

export function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
      geometries.add(child.geometry);
      const list = Array.isArray(child.material) ? child.material : [child.material];
      list.forEach((m) => {
        materials.add(m);
        if ((m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshBasicMaterial) && m.map) textures.add(m.map);
      });
    }
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose());
}

function makeHeroWorld(onTextureReady: () => void) {
  const world = new THREE.Group();
  world.name = "hero-island";
  const textures = new Map<string, THREE.Texture>();
  const material = (name: string, color = "#ffffff", cutout = false) => {
    let map = textures.get(name);
    if (!map) {
      map = new THREE.TextureLoader().load(`/minecraft/textures/block/${name}.png`, onTextureReady);
      map.colorSpace = THREE.SRGBColorSpace; map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter; map.generateMipmaps = false;
      textures.set(name, map);
    }
    return new THREE.MeshStandardMaterial({ map, color, roughness: 1, alphaTest: cutout ? .12 : 0 });
  };
  const dirt = material("dirt"), stone = material("stone"), grassSide = material("grass_block_side");
  const grassTop = material("grass_block_top", "#819e63");
  const overlay = material("grass_block_side_overlay", "#819e63", true);
  overlay.polygonOffset = true; overlay.polygonOffsetFactor = -1; overlay.polygonOffsetUnits = -1;
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const addBlock = (x: number, y: number, z: number, size = 1, grassy = true) => {
    const mesh = new THREE.Mesh(cube, grassy ? [grassSide, grassSide, grassTop, dirt, grassSide, grassSide] : stone);
    mesh.position.set(x, y, z); mesh.scale.setScalar(size); mesh.castShadow = true; mesh.receiveShadow = true; world.add(mesh);
    if (grassy) {
      const edge = new THREE.Mesh(cube, [overlay, overlay, hidden, hidden, overlay, overlay]);
      edge.position.copy(mesh.position); edge.scale.copy(mesh.scale); world.add(edge);
    }
    return mesh;
  };
  for (let x = -2; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if ((x === -2 && z === 1) || (x === 1 && z === -1)) continue;
    addBlock(x + .5, -.52, z, 1);
  }
  for (const [x, z] of [[-.5, -1], [.5, -1], [-.5, 0], [.5, 0], [-.5, 1]]) addBlock(x, -1.33, z, .95, false);
  addBlock(-.2, -1.91, -.1, .7, false);
  const trunkSide = material("oak_log"), trunkTop = material("oak_log_top");
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(.32, 1.42, .32), [trunkSide, trunkSide, trunkTop, trunkTop, trunkSide, trunkSide]);
  trunk.position.set(-1.65, .71, .05); trunk.castShadow = true; trunk.receiveShadow = true; world.add(trunk);
  const leaves = material("oak_leaves", "#75945d", true);
  for (const [x, y, z, size] of [[-1.65, 1.72, .05, 1.18], [-1.65, 2.35, .05, .78], [-2.17, 1.72, .05, .64], [-1.1, 1.72, .05, .64]]) {
    const leaf = new THREE.Mesh(cube, leaves); leaf.position.set(x, y, z); leaf.scale.setScalar(size); leaf.castShadow = true; leaf.receiveShadow = true; world.add(leaf);
  }
  const left = addBlock(-2.65, .7, .3, .5); left.rotation.set(.07, .28, -.05);
  const back = addBlock(2.55, 1.6, -1.65, .68); back.rotation.set(.08, -.24, .08);
  const amethyst = new THREE.Mesh(cube, material("amethyst_block"));
  amethyst.position.set(2.1, 3, -1.8); amethyst.scale.setScalar(.34); amethyst.rotation.set(.13, .3, -.08); amethyst.castShadow = true; world.add(amethyst);
  return world;
}

function fitHeroCamera(camera: THREE.PerspectiveCamera, model: THREE.Object3D, world: THREE.Object3D) {
  const bounds = visibleModelBounds(model).union(visibleModelBounds(world));
  const center = bounds.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(.46, .31, .84).normalize();
  camera.fov = 34;
  camera.position.copy(center).add(direction); camera.lookAt(center); camera.updateMatrixWorld(true);
  const inverse = camera.quaternion.clone().invert();
  const tangentY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tangentX = tangentY * Math.max(.3, camera.aspect);
  let distance = 1;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverse);
    distance = Math.max(distance, point.z + Math.abs(point.x) / tangentX, point.z + Math.abs(point.y) / tangentY);
  }
  camera.position.copy(center).addScaledVector(direction, distance * 1.13);
  camera.near = .05; camera.far = Math.max(100, distance * 5); camera.lookAt(center); camera.updateProjectionMatrix();
  return center;
}
const MinecraftScene = forwardRef<MinecraftSceneHandle, Props>(function MinecraftScene({
  pose, settings = DEFAULT_SCENE, interactive = true, hero = false, avatar, className = "", onSelectPart, selectedPart, onReady, onViewChange, onItemsReady, autoFrame = false, fitKey,
}, forwardedRef) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const props = useRef({ pose, settings, avatar, onSelectPart, selectedPart, onReady, onViewChange, onItemsReady, autoFrame, fitKey });
  props.current = { pose, settings, avatar, onSelectPart, selectedPart, onReady, onViewChange, onItemsReady, autoFrame, fitKey };
  const [failed, setFailed] = useState(false);
  const [skinError, setSkinError] = useState(false);

  const fitStage = (s: Stage) => {
    if (!s.ready || !Object.values(s.itemSlots).every(slot => slot.ready)) { s.needsFrame = true; return; }
    const aspect = s.camera.aspect;
    s.camera.aspect = hero ? aspect : Math.min(1, aspect);
    const target = hero && s.heroWorld ? fitHeroCamera(s.camera, s.model, s.heroWorld) : fitModelCamera(s.camera, s.model, props.current.settings.previewCamera);
    s.camera.aspect = aspect; s.camera.updateProjectionMatrix();
    s.controls.target.copy(target); s.controls.update(); s.needsFrame = false;
    s.render();
  };

  const syncItems = (s: Stage) => {
    const equipment: EquippedItems = props.current.avatar ? emptyItems() : props.current.settings.items || emptyItems();
    for (const hand of ["right", "left"] as const) {
      const entry = equipment[hand], slot = s.itemSlots[hand];
      const id = entry?.id || null;
      if (slot.id !== id) {
        slot.id = id; slot.revision++; slot.error = ""; slot.ready = !id;
        if (slot.model) { slot.root.remove(slot.model); disposeItemModel(slot.model); slot.model = undefined; }
        if (id) {
          const revision = slot.revision;
          void loadItemModel(id).then(model => {
            if (stage.current !== s || slot.revision !== revision || (props.current.settings.items?.[hand]?.id || null) !== id) { disposeItemModel(model); return; }
            slot.model = orientHeldModel(model, hand); slot.root.add(slot.model); slot.ready = true;
            syncItems(s); if (s.needsFrame) fitStage(s); s.render();
          }).catch(() => {
            if (stage.current !== s || slot.revision !== revision) return;
            slot.error = "Не удалось загрузить предмет. Уберите его из руки и добавьте снова.";
            syncItems(s);
          });
        }
      }
      if (entry) {
        const { position, rotation, scale } = entry.transform;
        slot.root.position.set(position.x, -1.25 + position.y, .1 + position.z);
        slot.root.rotation.set(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z));
        slot.root.scale.setScalar(scale);
      }
    }
    const ready = Object.values(s.itemSlots).every(slot => slot.ready);
    const error = Object.values(s.itemSlots).find(slot => slot.error)?.error || "";
    const status = `${ready}:${error}`;
    if (status !== s.itemStatus) { s.itemStatus = status; props.current.onItemsReady?.(ready, error); }
  };

  const apply = () => {
    const s = stage.current; if (!s) return;
    const current = props.current;
    const statePose = current.pose || (hero ? PRESETS[0].pose : DEFAULT_POSE);
    applyRigPose(s.model, s.parts, statePose, current.settings);
    if (s.frameKey !== current.fitKey) { s.frameKey = current.fitKey; s.needsFrame = current.autoFrame; s.hasUserView = false; }
    s.model.traverse(child => {
      if (child.userData.outline) child.visible = child.userData.outline === current.selectedPart && (current.avatar !== "head" || child.userData.outline === "head");
    });
    s.sword.visible = current.avatar || current.settings.items ? false : Boolean(current.settings.sword || hero);
    syncItems(s);
    s.floor.visible = current.settings.floor && !hero;
    s.grid.visible = current.settings.grid && !hero;
    s.keyLight.intensity = Math.max(0.1, current.settings.light || 1.5) * 2;
    s.scene.background = current.settings.background === "transparent" ? null : new THREE.Color(hero ? "#1b112b" : current.settings.background);
    if (s.needsFrame) fitStage(s);
    s.render();
  };

  useImperativeHandle(forwardedRef, () => ({
    capture(width = 1280, height = 1280, transparent = false) {
      const s = stage.current; if (!s) throw new Error("3D-сцена недоступна. Проверьте поддержку WebGL в браузере.");
      if (!s.ready || s.skin !== (props.current.settings.skin || "") || s.slim !== Boolean(props.current.settings.slim) || s.avatar !== props.current.avatar) {
        throw new Error("Дождитесь загрузки скина перед сохранением изображения.");
      }
      for (const hand of ["right", "left"] as const) {
        const slot = s.itemSlots[hand], expected = props.current.settings.items?.[hand]?.id || null;
        if (!props.current.avatar && (slot.id !== expected || !slot.ready)) throw new Error(slot.error || "Дождитесь загрузки предметов перед сохранением PNG.");
      }
      apply();
      width = Math.min(8192, Math.max(1, Math.round(Number.isFinite(width) ? width : 1280)));
      height = Math.min(8192, Math.max(1, Math.round(Number.isFinite(height) ? height : 1280)));
      const size = s.renderer.getSize(new THREE.Vector2()); const ratio = s.renderer.getPixelRatio();
      const background = s.scene.background; const aspect = s.camera.aspect; const environmentVisible = s.environment.visible;
      const outlines: THREE.Object3D[] = [];
      s.model.traverse(child => { if (child.userData.outline && child.visible) { outlines.push(child); child.visible = false; } });
      try {
        s.renderer.setPixelRatio(1); s.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
        s.camera.aspect = width / height; s.camera.updateProjectionMatrix();
        if (transparent) { s.scene.background = null; s.environment.visible = false; }
        s.render(); return s.renderer.domElement.toDataURL("image/png");
      } finally {
        s.scene.background = background; s.environment.visible = environmentVisible;
        outlines.forEach(outline => { outline.visible = true; });
        s.camera.aspect = aspect; s.camera.updateProjectionMatrix(); s.renderer.setPixelRatio(ratio);
        s.renderer.setSize(size.x, size.y, false); s.render();
      }
    },
    resetCamera() {
      const s = stage.current; if (!s) return;
      if (props.current.autoFrame || hero) { s.hasUserView = false; fitStage(s); }
      else { frameCamera(s.camera, s.controls, hero, props.current.avatar); s.render(); }
    },
    fitCamera() { if (stage.current) fitStage(stage.current); },
  }), [hero]);

  useEffect(() => {
    const container = host.current; if (!container) return;
    props.current.onReady?.(false); setSkinError(false);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" }); }
    catch { setFailed(true); return; }
    setFailed(false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-label", "3D-модель Minecraft. Перетаскивайте для вращения, используйте колёсико для масштаба.");
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;outline:none;touch-action:none;";
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(hero ? 36 : 31, 1, 0.1, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = interactive; controls.enableDamping = false;
    controls.minDistance = avatar ? 1.8 : 4; controls.maxDistance = 22; controls.maxPolarAngle = Math.PI * 0.88;
    frameCamera(camera, controls, hero, avatar);
    scene.add(new THREE.HemisphereLight(hero ? 0xf1e8fa : 0xe7d9f5, hero ? 0x30273b : 0x383044, hero ? 2.1 : 2.5));
    const keyLight = new THREE.DirectionalLight(0xffe9c4, 3.2); keyLight.position.set(-4, 8, 6); keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024); keyLight.shadow.camera.left = -6; keyLight.shadow.camera.right = 6;
    keyLight.shadow.camera.top = 7; keyLight.shadow.camera.bottom = -6; keyLight.shadow.normalBias = 0.025; scene.add(keyLight);
    const rim = new THREE.DirectionalLight(hero ? 0xc8b1df : 0xbaa7ef, hero ? 1.45 : 2.3); rim.position.set(5, 4, -5); scene.add(rim);
    const environment = new THREE.Group(); scene.add(environment);
    const floor = new THREE.Group(); environment.add(floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x261d32, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.025; ground.receiveShadow = true; floor.add(ground);
    const grid = new THREE.GridHelper(40, 40, 0x6c5085, 0x3f304f); grid.position.y = -0.012; environment.add(grid);

    let currentTexture = skinTexture(makeDefaultSkin()).texture;
    let player = createPlayer(currentTexture, Boolean(props.current.settings.slim), false);
    prepareAvatar(player, avatar);
    if (avatar && props.current.settings.skin) player.model.visible = false;
    scene.add(player.model);
    const render = () => renderer.render(scene, camera);
    const heroWorld = hero ? makeHeroWorld(() => { if (stage.current?.renderer === renderer) render(); }) : undefined;
    if (heroWorld) environment.add(heroWorld);
    const resize = () => {
      const rect = container.getBoundingClientRect(); if (rect.width < 1 || rect.height < 1) return;
      renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
      const s = stage.current;
      if (s?.renderer === renderer && (props.current.autoFrame || hero) && !s.hasUserView) { s.needsFrame = true; fitStage(s); }
      render();
    };
    const requestedSkin = props.current.settings.skin || "";
    const requestedSlim = Boolean(props.current.settings.slim);
    stage.current = { renderer, scene, camera, controls, environment, floor, grid, keyLight, ...player, ready: false, skin: requestedSkin, slim: requestedSlim, avatar, render, resize, itemSlots: handSlots(player.parts), itemStatus: "", needsFrame: autoFrame || hero, frameKey: fitKey, hasUserView: false, heroWorld };
    apply(); resize();
    const viewChange = () => { render(); props.current.onViewChange?.(); };
    const observer = new ResizeObserver(resize); observer.observe(container); controls.addEventListener("change", viewChange);
    let disposed = false;
    let skinImage: HTMLImageElement | undefined;
    if (props.current.settings.skin) {
      const image = new Image(); skinImage = image; image.crossOrigin = "anonymous";
      const failSkin = () => {
        if (disposed || requestedSkin !== (props.current.settings.skin || "") || requestedSlim !== Boolean(props.current.settings.slim) || avatar !== props.current.avatar) return;
        setSkinError(true); props.current.onReady?.(false);
      };
      image.onload = () => {
        if (disposed || requestedSkin !== (props.current.settings.skin || "") || requestedSlim !== Boolean(props.current.settings.slim) || avatar !== props.current.avatar) return;
        if (avatar && (image.naturalWidth !== 64 || ![32, 64].includes(image.naturalHeight))) { failSkin(); return; }
        try {
          const loaded = skinTexture(image);
          const previous = player;
          currentTexture.dispose(); currentTexture = loaded.texture; player = createPlayer(currentTexture, Boolean(props.current.settings.slim), loaded.legacy);
          if (stage.current?.renderer === renderer) for (const hand of ["right", "left"] as const) player.parts[hand === "right" ? "rightArm" : "leftArm"].add(stage.current.itemSlots[hand].root);
          scene.remove(previous.model); disposeObject(previous.model);
          prepareAvatar(player, avatar);
          scene.add(player.model); if (stage.current?.renderer === renderer) Object.assign(stage.current, player);
          apply();
          if (stage.current?.renderer === renderer) stage.current.ready = true;
          if (stage.current?.renderer === renderer && stage.current.needsFrame) fitStage(stage.current);
          props.current.onReady?.(true);
        } catch { failSkin(); }
      };
      image.onerror = failSkin;
      image.src = props.current.settings.skin;
    } else {
      stage.current.ready = true; if (stage.current.needsFrame) fitStage(stage.current); props.current.onReady?.(true);
    }
    const raycaster = new THREE.Raycaster(); const mouse = new THREE.Vector2(); let downX = 0; let downY = 0;
    const pointerDown = (event: PointerEvent) => { downX = event.clientX; downY = event.clientY; if (stage.current?.renderer === renderer) stage.current.hasUserView = true; };
    const wheel = () => { if (stage.current?.renderer === renderer) stage.current.hasUserView = true; };
    const pointerUp = (event: PointerEvent) => {
      if (!interactive || !props.current.onSelectPart || Math.hypot(event.clientX - downX, event.clientY - downY) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect(); mouse.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObject(player.model, true).find(item => item.object.userData.part);
      if (hit) props.current.onSelectPart(hit.object.userData.part as BodyPart);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown); renderer.domElement.addEventListener("pointerup", pointerUp); renderer.domElement.addEventListener("wheel", wheel, { passive: true });
    return () => {
      disposed = true; props.current.onReady?.(false);
      if (skinImage) { skinImage.onload = null; skinImage.onerror = null; }
      observer.disconnect(); controls.removeEventListener("change", viewChange); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("wheel", wheel);
      if (stage.current?.renderer === renderer) for (const slot of Object.values(stage.current.itemSlots)) {
        slot.revision++; slot.root.removeFromParent(); disposeItemModel(slot.root);
      }
      disposeObject(scene); currentTexture.dispose(); keyLight.shadow.map?.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      if (stage.current?.renderer === renderer) stage.current = null;
    };
    // Skin and body type change the geometry; the remaining settings update the existing scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hero, interactive, avatar, settings.skin, settings.slim]);

  useEffect(() => { apply(); });

  return <div ref={host} className={`minecraft-scene ${className}`} style={{ width: "100%", height: "100%", minHeight: 160, position: "relative", overflow: "hidden" }}>
    {failed && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: settings.background === "transparent" ? "transparent" : settings.background }}>
      {!avatar && <CharacterArt variant={0} pose={pose} className="scene-fallback-art" />}
      <span style={{ position: "absolute", bottom: 12, left: 12, right: 12, fontSize: 11, color: "#b4a6c1", textAlign: "center" }}>Для интерактивной сцены включите WebGL</span>
    </div>}
    {avatar && skinError && <div role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, background: "#21172ee6", color: "#f0e6fb", fontSize: 13, textAlign: "center" }}>Не удалось загрузить скин. Выберите другой PNG-файл размером 64 × 64 или 64 × 32.</div>}
  </div>;
});

export default MinecraftScene;

/** Original code-drawn voxel character: lightweight card art without additional WebGL contexts. */
export function CharacterArt({ variant = 0, className = "", pose }: { variant?: number; className?: string; pose?: Pose }) {
  const palettes = [
    { shirt: "#9766ce", light: "#b48be4", dark: "#603f86", hair: "#49332b", pants: "#4c3c65", side: "#332945", accent: "#efc374" },
    { shirt: "#9d79d1", light: "#b599e4", dark: "#674d98", hair: "#3e2d36", pants: "#45475e", side: "#303145", accent: "#e5bb83" },
    { shirt: "#579dbb", light: "#8bc5d7", dark: "#326985", hair: "#3d3331", pants: "#36455c", side: "#263349", accent: "#d9b876" },
    { shirt: "#d8a057", light: "#ebbc74", dark: "#9d6c3c", hair: "#633e2a", pants: "#45615b", side: "#2e4541", accent: "#e6c689" },
  ];
  const p = palettes[((variant % 4) + 4) % 4];
  const index = ((variant % 4) + 4) % 4;
  const previewPose = pose || PRESETS[index].pose;
  // Project both forward motion and sideways rotation into the card's fixed
  // isometric view so running, waving and relaxed presets keep their silhouettes.
  const clamp = (angle: number, limit = 150) => Math.max(-limit, Math.min(limit, angle));
  const leftRotation = clamp(previewPose.leftArm.z * 0.85 + previewPose.leftArm.x * 0.38);
  const rightRotation = clamp(previewPose.rightArm.z * 0.8 - previewPose.rightArm.x * 0.32 + (index === 2 ? 28 : 0));
  const leftLeg = clamp(previewPose.leftLeg.z * 0.8 + previewPose.leftLeg.x * 0.75, 42);
  const rightLeg = clamp(previewPose.rightLeg.z * 0.8 + previewPose.rightLeg.x * 0.7, 42);
  const bodyLean = clamp(previewPose.body.z * 0.4 + previewPose.body.x * 0.15 + previewPose.body.y * 0.08 + (index === 0 ? -4 : 0), 10);
  const headTilt = clamp(previewPose.head.z * 0.55 + previewPose.head.y * 0.1, 15);
  const hasSword = index === 0 || index === 2;
  const swordAngle = index === 2 ? -43 : -28;
  return <svg viewBox="0 0 300 300" className={className} role="img" aria-label="Пиксельный персонаж Minecraft" style={{ width: "100%", height: "100%", maxHeight: "100%", overflow: "visible" }}>
    <ellipse cx="150" cy="273" rx={index === 0 || index === 2 ? 76 : 56} ry="8" fill="#000" opacity=".14" />
    <g transform={`translate(0,-1) rotate(${bodyLean} 150 178)`}>
      <g transform={`rotate(${rightLeg} 137 183)`}>
        <path d="M117 173 145 183 145 257 117 247Z" fill={p.pants} /><path d="M145 183 156 175 156 249 145 257Z" fill={p.side} />
        <path d="M117 231 145 241 145 257 117 247Z" fill="#483d35" /><path d="M145 241 156 233 156 249 145 257Z" fill="#302b29" />
        <path d="m122 191 8 3v9l-8-3zm12 20 7 2v8l-7-2z" fill="#ffffff" opacity=".06" />
      </g>
      <g transform={`rotate(${leftLeg} 167 183)`}>
        <path d="M149 183 178 172 178 247 149 258Z" fill={p.pants} /><path d="M178 172 189 180 189 255 178 247Z" fill={p.side} />
        <path d="M149 241 178 230 178 247 149 258Z" fill="#55463a" /><path d="M178 230 189 238 189 255 178 247Z" fill="#352e29" />
        <path d="m155 200 8-3v10l-8 3zm12 17 6-2v8l-6 2z" fill="#ffffff" opacity=".06" />
      </g>
      <g transform={`rotate(${rightRotation} 112 122)`}>
        <path d="m92 110 24 9v62l-24-9z" fill={p.shirt} /><path d="m116 119 12-8v62l-12 8z" fill={p.dark} /><path d="m92 110 12-8 24 9-12 8z" fill={p.light} />
        <path d="m92 147 24 9v25l-24-9z" fill="#d9aa7c" /><path d="m116 156 12-8v25l-12 8z" fill="#ac7f5c" />
        <path d="m92 163 24 9v8l-24-9z" fill="#6a5441" />
        {hasSword && <g transform={`translate(104 165) rotate(${swordAngle - rightRotation})`}>
          <path d="M-3-6H3V17H-3Z" fill="#725037" /><path d="M-3 12H3V17H-3Z" fill="#453024" />
          <path d="M-15-12H15V-5H-15Z" fill="#20595a" /><path d="M-11-12H11V-9H-11Z" fill="#63cdbb" />
          <path d="M-6-63 0-70 6-63V-12H-6Z" fill="#6ce5cc" /><path d="M-6-63 0-70 0-12H-6Z" fill="#329e97" />
          <path d="M2-63H6V-12H2Z" fill="#b4ffee" /><path d="M0-70 6-63H0Z" fill="#b4ffee" />
        </g>}
      </g>
      <path d="m118 111 45-15 25 14-44 16z" fill={p.light} /><path d="m118 111 45 15v68l-45-15z" fill={p.shirt} /><path d="m163 126 25-16v68l-25 16z" fill={p.dark} />
      <path d="m118 115 45 15v9l-45-15z" fill={p.accent} /><path d="m163 130 25-16v9l-25 16z" fill="#b68c4b" />
      <path d="m118 171 45 15v8l-45-15z" fill="#4d385f" /><path d="m163 186 25-16v8l-25 16z" fill="#35283f" /><path d="m137 178 10 3v8l-10-3z" fill="#c19b56" />
      <path d="m125 137 9 3v9l-9-3zm22 15 9 3v12l-9-3z" fill="#ffffff" opacity=".08" />
      <g transform={`rotate(${leftRotation} 189 120)`}>
        <path d="m185 112 24 9v62l-24-9z" fill={p.shirt} /><path d="m209 121 12-8v62l-12 8z" fill={p.dark} /><path d="m185 112 12-8 24 9-12 8z" fill={p.light} />
        <path d="m185 149 24 9v25l-24-9z" fill="#e2b487" /><path d="m209 158 12-8v25l-12 8z" fill="#bc8c63" /><path d="m185 165 24 9v8l-24-9z" fill="#6a5441" />
      </g>
      <g transform={`rotate(${headTilt} 152 94)`}>
        <path d="m112 47 49-16 39 22-49 17z" fill="#71503a" /><path d="m112 47 49 23v49l-49-23z" fill="#ddb084" /><path d="m161 70 39-17v49l-39 17z" fill="#bd8c65" />
        <path d="m112 47 49 23v16l-49-23z" fill={p.hair} /><path d="m161 70 39-17v19l-39 17z" fill="#382b27" />
        <path d="m112 61 9 4v18l-9-4zm39 13 10 5v17l-10-5z" fill={p.hair} />
        <path d="m122 80 11 5v8l-11-5zm23 11 10 5v8l-10-5z" fill="#f4eee1" /><path d="m128 83 5 2v8l-5-2zm17 8 5 2v8l-5-2z" fill="#4c797f" />
        <path d="m133 96 11 5v7l-11-5z" fill="#b7815d" /><path d="m126 106 24 11v5l-24-11z" fill="#79513d" />
        <path d="m172 80 9-4v9l-9 4z" fill="#a67754" opacity=".6" /><path d="m121 44 10-3 11 6-10 3zm25 9 10-3 10 6-10 3z" fill="#8b6546" opacity=".5" />
      </g>
    </g>
  </svg>;
}
