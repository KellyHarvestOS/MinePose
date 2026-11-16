import * as THREE from "three";
import type { BodyPart, Pose, SceneSettings } from "./types";

export function visibleModelBounds(model: THREE.Object3D) {
  const bounds = new THREE.Box3();
  model.updateMatrixWorld(true);
  model.traverseVisible(child => {
    if (!(child instanceof THREE.Mesh) || child.userData.outline) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (child.geometry.boundingBox) bounds.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
  });
  return bounds;
}

export function applyRigPose(model: THREE.Group, parts: Record<BodyPart, THREE.Group>, pose: Pose, settings: SceneSettings) {
  for (const id of Object.keys(parts) as BodyPart[]) {
    const rotation = pose[id];
    parts[id].rotation.set(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z));
  }
  const position = settings.modelPosition || { x: 0, y: 0, z: 0 };
  const rotation = settings.modelRotation || { x: 0, y: 0, z: 0 };
  model.position.set(position.x, position.y, position.z);
  model.rotation.set(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z));
}

export function fitModelCamera(camera: THREE.PerspectiveCamera, model: THREE.Object3D, direction?: { azimuth: number; elevation: number }, includeGround = true) {
  const bounds = visibleModelBounds(model);
  if (bounds.isEmpty()) return new THREE.Vector3(0, 2, 0);
  if (includeGround && bounds.min.y > .12) bounds.min.y = 0;
  const center = bounds.getCenter(new THREE.Vector3());
  const azimuth = THREE.MathUtils.degToRad(direction?.azimuth ?? 31);
  const elevation = THREE.MathUtils.degToRad(direction?.elevation ?? 11);
  const view = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
  camera.position.copy(center).add(view); camera.lookAt(center); camera.updateMatrixWorld(true);
  const inverse = camera.quaternion.clone().invert();
  const tangentY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tangentX = tangentY * Math.max(.1, camera.aspect);
  let distance = 1;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const point = new THREE.Vector3(x, y, z).sub(center).applyQuaternion(inverse);
    distance = Math.max(distance, point.z + Math.abs(point.x) / tangentX, point.z + Math.abs(point.y) / tangentY);
  }
  camera.position.copy(center).addScaledVector(view, distance * 1.15);
  camera.near = .05; camera.far = Math.max(100, distance * 5); camera.lookAt(center); camera.updateProjectionMatrix();
  return center;
}

export function contactShadow(model: THREE.Object3D) {
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 3, 64, 64, 63);
  gradient.addColorStop(0, "rgba(8,5,15,.4)"); gradient.addColorStop(.45, "rgba(8,5,15,.18)"); gradient.addColorStop(1, "rgba(8,5,15,0)");
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  const bounds = visibleModelBounds(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(1.8, size.x * 1.15), Math.max(1.4, size.z * 1.25)), new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 1 / (1 + Math.max(0, bounds.min.y)) }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(center.x, -.035, center.z);
  return shadow;
}
