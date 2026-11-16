import * as THREE from "three";
import { getItemDefinition } from "./items";

type Vector = [number, number, number];
type FaceName = "north" | "south" | "east" | "west" | "up" | "down";
type ModelFace = { texture: string; uv?: [number, number, number, number]; rotation?: number; tintindex?: number };
type ModelElement = {
  from: Vector;
  to: Vector;
  rotation?: { origin: Vector; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  faces: Partial<Record<FaceName, ModelFace>>;
};
type ItemModelData = {
  kind: "generated" | "elements" | "special";
  textures: Record<string, string>;
  layers?: string[];
  elements?: ModelElement[];
  special?: string;
  display?: Record<string, { rotation?: Vector; translation?: Vector; scale?: Vector }>;
  tints?: string[];
};
type ImageDataSource = { canvas: HTMLCanvasElement; pixels: Uint8ClampedArray; width: number; height: number };
type Buffers = { positions: number[]; normals: number[]; uvs: number[]; indices: number[] };

// Only source images and model documents are shared. Every returned model owns
// its geometry, materials and GPU textures and can be disposed independently.
const imageCache = new Map<string, Promise<ImageDataSource>>();
const modelCache = new Map<string, Promise<ItemModelData>>();
const FACE_NAMES: FaceName[] = ["north", "south", "east", "west", "up", "down"];

function sourceImage(url: string, animated = false): Promise<ImageDataSource> {
  const key = `${url}:${animated}`;
  let pending = imageCache.get(key);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Не удалось загрузить текстуру предмета"));
      image.src = url;
    }).then(image => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = animated && image.naturalHeight > image.naturalWidth ? image.naturalWidth : image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Не удалось прочитать текстуру предмета");
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0);
      return { canvas, width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    });
    imageCache.set(key, pending);
    pending.catch(() => imageCache.delete(key));
  }
  return pending;
}

function modelData(url: string): Promise<ItemModelData> {
  let pending = modelCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async response => {
      if (!response.ok) throw new Error("Не удалось загрузить модель предмета");
      return response.json() as Promise<ItemModelData>;
    });
    modelCache.set(url, pending);
    pending.catch(() => modelCache.delete(url));
  }
  return pending;
}

function texture(source: ImageDataSource) {
  const result = new THREE.CanvasTexture(source.canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.magFilter = THREE.NearestFilter;
  result.minFilter = THREE.NearestFilter;
  result.generateMipmaps = false;
  return result;
}

function material(source: ImageDataSource, tint = "#ffffff") {
  let translucent = false;
  for (let index = 3; index < source.pixels.length; index += 4) {
    if (source.pixels[index] > 20 && source.pixels[index] < 245) { translucent = true; break; }
  }
  return new THREE.MeshStandardMaterial({
    map: texture(source), color: tint, roughness: .88, metalness: 0,
    alphaTest: .08, transparent: translucent, depthWrite: !translucent,
  });
}

function buffers(): Buffers { return { positions: [], normals: [], uvs: [], indices: [] }; }
function quad(target: Buffers, vertices: Vector[], uv: [number, number][], normal: Vector) {
  const index = target.positions.length / 3;
  vertices.forEach((vertex, i) => { target.positions.push(...vertex); target.normals.push(...normal); target.uvs.push(...uv[i]); });
  target.indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
}
function geometry(data: Buffers) {
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
  result.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
  result.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
  result.setIndex(data.indices);
  result.computeBoundingBox(); result.computeBoundingSphere();
  return result;
}
function mesh(data: Buffers, surface: THREE.Material) {
  const result = new THREE.Mesh(geometry(data), surface);
  result.castShadow = true; result.receiveShadow = true;
  return result;
}

/** Closed, textured pixel extrusion. Adjacent opaque pixels share their volume
 * and have no interior walls; holes and the outer silhouette have real edges. */
function extrudePixels(source: ImageDataSource, depthOffset = 0) {
  const data = buffers();
  const width = source.width, height = source.height;
  const unitX = 16 / width, unitY = 16 / height;
  const back = -.5 - depthOffset, front = .5 + depthOffset;
  const present = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && source.pixels[(y * width + x) * 4 + 3] >= 20;
  let opaquePixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!present(x, y)) continue;
    opaquePixels++;
    const x0 = x * unitX, x1 = (x + 1) * unitX, y0 = 16 - (y + 1) * unitY, y1 = 16 - y * unitY;
    const u0 = x / width, u1 = (x + 1) / width, v0 = 1 - (y + 1) / height, v1 = 1 - y / height;
    const uv: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    quad(data, [[x0, y0, front], [x1, y0, front], [x1, y1, front], [x0, y1, front]], uv, [0, 0, 1]);
    quad(data, [[x1, y0, back], [x0, y0, back], [x0, y1, back], [x1, y1, back]], [uv[1], uv[0], uv[3], uv[2]], [0, 0, -1]);
    // Edge walls sample the centre of their pixel. This prevents transparent
    // neighbours from cutting holes into a one-pixel-wide tool when rotated.
    const sample: [number, number] = [(x + .5) / width, 1 - (y + .5) / height];
    const sideUV = [sample, sample, sample, sample];
    if (!present(x - 1, y)) quad(data, [[x0, y0, back], [x0, y0, front], [x0, y1, front], [x0, y1, back]], sideUV, [-1, 0, 0]);
    if (!present(x + 1, y)) quad(data, [[x1, y0, front], [x1, y0, back], [x1, y1, back], [x1, y1, front]], sideUV, [1, 0, 0]);
    if (!present(x, y - 1)) quad(data, [[x0, y1, front], [x1, y1, front], [x1, y1, back], [x0, y1, back]], sideUV, [0, 1, 0]);
    if (!present(x, y + 1)) quad(data, [[x0, y0, back], [x1, y0, back], [x1, y0, front], [x0, y0, front]], sideUV, [0, -1, 0]);
  }
  return { data, opaquePixels };
}

function faceVertices(name: FaceName, from: Vector, to: Vector): { vertices: Vector[]; normal: Vector } {
  const [x0, y0, z0] = from, [x1, y1, z1] = to;
  switch (name) {
    case "south": return { vertices: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], normal: [0, 0, 1] };
    case "north": return { vertices: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], normal: [0, 0, -1] };
    case "east": return { vertices: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], normal: [1, 0, 0] };
    case "west": return { vertices: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], normal: [-1, 0, 0] };
    case "up": return { vertices: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], normal: [0, 1, 0] };
    case "down": return { vertices: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], normal: [0, -1, 0] };
  }
}
function defaultUV(name: FaceName, from: Vector, to: Vector): [number, number, number, number] {
  const [x0, y0, z0] = from, [x1, y1, z1] = to;
  switch (name) {
    case "down": return [x0, 16 - z1, x1, 16 - z0];
    case "up": return [x0, z0, x1, z1];
    case "north": return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
    case "south": return [x0, 16 - y1, x1, 16 - y0];
    case "west": return [z0, 16 - y1, z1, 16 - y0];
    case "east": return [16 - z1, 16 - y1, 16 - z0, 16 - y0];
  }
}
function faceUV(rect: [number, number, number, number], rotation = 0, width = 16, height = 16): [number, number][] {
  const [x0, y0, x1, y1] = rect;
  const uv: [number, number][] = [[x0 / width, 1 - y1 / height], [x1 / width, 1 - y1 / height], [x1 / width, 1 - y0 / height], [x0 / width, 1 - y0 / height]];
  const offset = ((Math.round(rotation / 90) % 4) + 4) % 4;
  return uv.map((_, index) => uv[(index + offset) % 4]);
}

function resolveTexture(model: ItemModelData, name: string): string {
  let value = name;
  const visited = new Set<string>();
  while (value.startsWith("#")) {
    if (visited.has(value)) throw new Error("Циклическая ссылка на текстуру предмета");
    visited.add(value); value = model.textures[value.slice(1)];
    if (!value) throw new Error("Текстура модели предмета отсутствует");
  }
  return value;
}

async function cuboidModels(model: ItemModelData, group: THREE.Group) {
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const paintedFaces = new Map<string, number>();
  async function surface(face: ModelFace, overlayDepth: number) {
    const url = resolveTexture(model, face.texture);
    const tint = face.tintindex === undefined ? "#ffffff" : model.tints?.[face.tintindex] || "#91bd59";
    const key = `${url}:${tint}:${overlayDepth}`;
    let result = materials.get(key);
    if (!result) {
      result = material(await sourceImage(url, true), tint);
      if (overlayDepth) {
        result.polygonOffset = true;
        result.polygonOffsetFactor = -overlayDepth;
        result.polygonOffsetUnits = -overlayDepth;
      }
      materials.set(key, result);
    }
    return result;
  }
  // Resolve all material promises first. Concurrent requests for a single image
  // share sourceImage(), while each model gets its own disposable GPU maps.
  for (const element of model.elements || []) {
    const elementGroup = new THREE.Group();
    for (const name of FACE_NAMES) {
      const face = element.faces[name]; if (!face) continue;
      const data = buffers(), { vertices, normal } = faceVertices(name, element.from, element.to);
      // Grass uses a tinted, cutout overlay exactly on its dirt side. A small
      // depth bias draws that second skin cleanly without changing its shape.
      const faceKey = `${name}:${JSON.stringify(vertices)}:${JSON.stringify(element.rotation || null)}`;
      const overlayDepth = paintedFaces.get(faceKey) || 0;
      paintedFaces.set(faceKey, overlayDepth + 1);
      quad(data, vertices, faceUV(face.uv || defaultUV(name, element.from, element.to), face.rotation), normal);
      elementGroup.add(mesh(data, await surface(face, overlayDepth)));
    }
    if (element.rotation) {
      const rotation = element.rotation;
      elementGroup.children.forEach(child => child.position.set(-rotation.origin[0], -rotation.origin[1], -rotation.origin[2]));
      elementGroup.position.fromArray(rotation.origin);
      elementGroup.rotation[rotation.axis] = THREE.MathUtils.degToRad(rotation.angle);
      if (rotation.rescale) {
        const factor = 1 / Math.cos(THREE.MathUtils.degToRad(rotation.angle));
        for (const axis of ["x", "y", "z"] as const) if (axis !== rotation.axis) elementGroup.scale[axis] = factor;
      }
    }
    group.add(elementGroup);
  }
}

/** Entity models use pixel UV coordinates, not block-model's 0..16 UV space. */
function atlasBox(group: THREE.Group, surface: THREE.Material, dimensions: [number, number], from: Vector, size: Vector, u: number, v: number) {
  const [w, h, d] = size;
  const to: Vector = [from[0] + w, from[1] + h, from[2] + d];
  const rects: Record<FaceName, [number, number, number, number]> = {
    south: [u + d, v + d, u + d + w, v + d + h],
    north: [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h],
    east: [u + d + w, v + d, u + 2 * d + w, v + d + h],
    west: [u, v + d, u + d, v + d + h],
    up: [u + d, v, u + d + w, v + d],
    down: [u + d + w, v, u + d + 2 * w, v + d],
  };
  const data = buffers();
  for (const name of FACE_NAMES) {
    const { vertices, normal } = faceVertices(name, from, to);
    quad(data, vertices, faceUV(rects[name], 0, dimensions[0], dimensions[1]), normal);
  }
  group.add(mesh(data, surface));
}

async function specialModel(model: ItemModelData, group: THREE.Group, id: string) {
  const kind = model.special || id;
  const url = model.textures.entity || model.textures.texture || Object.values(model.textures)[0];
  if (!url) throw new Error("Текстура специального предмета отсутствует");
  const source = await sourceImage(url);
  const surface = material(source);
  const size: [number, number] = [source.width, source.height];
  const box = (from: Vector, dimensions: Vector, u: number, v: number) => atlasBox(group, surface, size, from, dimensions, u, v);
  if (kind === "shield") {
    box([-6, -11, 0], [12, 22, 1], 0, 0);
    box([-1, -3, -6], [2, 6, 6], 26, 0);
  } else if (kind === "trident") {
    // Vanilla's model uses downward-positive Y; these coordinates are converted
    // to the editor's upward-positive convention without mirroring the texture.
    box([-.5, -27, -.5], [1, 25, 1], 0, 6);
    box([-1.5, -2, -.5], [3, 2, 1], 4, 0);
    box([-2.5, -1, -.5], [1, 4, 1], 4, 3);
    box([-.5, 0, -.5], [1, 4, 1], 0, 0);
    box([1.5, -1, -.5], [1, 4, 1], 4, 3);
  } else if (kind === "chest" || kind === "ender_chest") {
    box([1, 0, 1], [14, 10, 14], 0, 19);
    box([1, 10, 1], [14, 5, 14], 0, 0);
    box([7, 8, 15], [2, 4, 1], 0, 0);
  } else {
    surface.map?.dispose(); surface.dispose();
    throw new Error(`Неизвестная специальная модель: ${kind}`);
  }
}

export async function loadItemModel(id: string): Promise<THREE.Group> {
  const definition = getItemDefinition(id);
  if (!definition) throw new Error("Неизвестный предмет Minecraft");
  const model = await modelData(definition.model);
  const group = new THREE.Group();
  group.name = `item:${id}`;
  group.userData.itemId = id;
  group.userData.kind = model.kind;
  group.userData.display = model.display || {};
  let opaquePixels = 0;
  try {
    const glint = model.textures.glint ? await sourceImage(model.textures.glint) : undefined;
    if (model.kind === "generated") {
      const layers = model.layers?.length ? model.layers : Object.keys(model.textures).filter(key => /^layer\d+$/.test(key)).sort().map(key => model.textures[key]);
      if (!layers.length) throw new Error("В модели предмета отсутствуют слои");
      for (let index = 0; index < layers.length; index++) {
        const source = await sourceImage(resolveTexture(model, layers[index]), true);
        const extruded = extrudePixels(source, index * .0125);
        const tint = model.tints?.[index] || "#ffffff";
        const surface = material(source, tint);
        if (glint) {
          const glintMap = texture(glint);
          glintMap.wrapS = glintMap.wrapT = THREE.RepeatWrapping;
          surface.userData.glintTexture = glintMap;
          surface.onBeforeCompile = shader => {
            shader.uniforms.itemGlint = { value: glintMap };
            shader.fragmentShader = `uniform sampler2D itemGlint;\n${shader.fragmentShader}`;
            shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
              vec2 glintUv = vec2(vMapUv.x + vMapUv.y, vMapUv.y - vMapUv.x) * 1.8;
              float glintLight = texture2D(itemGlint, glintUv).r;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.27, 0.94), glintLight * 0.55);
            `);
          };
          surface.customProgramCacheKey = () => "minepose-item-glint-v1";
        }
        const rendered = mesh(extruded.data, surface);
        group.add(rendered); opaquePixels += extruded.opaquePixels;
      }
    } else if (model.kind === "elements") {
      await cuboidModels(model, group);
    } else if (model.kind === "special") {
      await specialModel(model, group, id);
    } else throw new Error("Неподдерживаемая модель предмета");
    if (!group.children.length) throw new Error("Модель предмета пуста");
    group.scale.setScalar(1 / 16);
    group.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(group);
    const center = bounds.getCenter(new THREE.Vector3());
    group.position.sub(center);
    // Keep the canonical root transform clean so consumers can set grip offsets
    // without losing the geometry's centering or the Minecraft pixel unit.
    const root = new THREE.Group();
    root.add(group); root.name = group.name; root.userData = { ...group.userData };
    let vertices = 0;
    group.traverse(child => { if (child instanceof THREE.Mesh) vertices += child.geometry.getAttribute("position").count; });
    root.userData.vertexCount = vertices;
    root.userData.opaquePixels = opaquePixels;
    root.userData.bounds = bounds.getSize(new THREE.Vector3()).toArray();
    return root;
  } catch (error) { disposeItemModel(group); throw error; }
}

export function disposeItemModel(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  group.traverse(child => {
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
    geometries.add(child.geometry);
    for (const surface of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(surface);
      if (surface instanceof THREE.MeshStandardMaterial || surface instanceof THREE.MeshBasicMaterial) {
        if (surface.map) textures.add(surface.map);
      }
      if (surface.userData.glintTexture instanceof THREE.Texture) textures.add(surface.userData.glintTexture);
    }
  });
  geometries.forEach(resource => resource.dispose());
  materials.forEach(resource => resource.dispose());
  textures.forEach(resource => resource.dispose());
}
