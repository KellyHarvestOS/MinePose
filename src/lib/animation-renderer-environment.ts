import * as THREE from "three";

export type StudioEnvironmentOptions = { environment: string; floor: boolean; floorSize: number; shadows: boolean };

async function blockTexture(name: string, repeat = 1) {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error(`Не удалось загрузить текстуру ${name}`)); image.src = `/minecraft/textures/block/${name}.png`;
  });
  const canvas = document.createElement("canvas"); canvas.width = source.naturalWidth; canvas.height = Math.min(source.naturalWidth, source.naturalHeight);
  const context = canvas.getContext("2d")!; context.imageSmoothingEnabled = false; context.drawImage(source, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(repeat, repeat);
  return texture;
}

export async function createStudioEnvironment(options: StudioEnvironmentOptions) {
  const group = new THREE.Group(); group.name = "studio-environment";
  const size = Math.max(2, Math.min(64, options.floorSize || 12));
  const theme = options.environment || "studio";
  let cube: THREE.BoxGeometry | undefined;
  const materials = new Map<string, Promise<THREE.MeshStandardMaterial>>();
  const surface = (name: string, color = "#ffffff", cutout = false) => {
    const key = `${name}:${color}:${cutout}`;
    if (!materials.has(key)) materials.set(key, blockTexture(name).then(map => new THREE.MeshStandardMaterial({ map, color, roughness: 1, alphaTest: cutout ? .1 : 0 })));
    return materials.get(key)!;
  };
  const addBox = (material: THREE.Material | THREE.Material[], x: number, y: number, z: number, width = 1, height = 1, depth = 1) => {
    cube ||= new THREE.BoxGeometry(1, 1, 1);
    const box = new THREE.Mesh(cube, material); box.position.set(x, y, z); box.scale.set(width, height, depth); box.castShadow = options.shadows; box.receiveShadow = options.shadows; group.add(box); return box;
  };
  try {
    if (options.floor && theme !== "empty") {
      const terrain: Record<string, [string, string]> = { plains: ["grass_block_top", "#93b968"], forest: ["grass_block_top", "#84a65e"], desert: ["sand", "#ffffff"], snow: ["snow", "#ffffff"], cave: ["stone", "#a3a0aa"], nether: ["netherrack", "#ffffff"], end: ["end_stone", "#ffffff"], sky: ["grass_block_top", "#96ba70"] };
      const tile = terrain[theme];
      const floorMaterial = new THREE.MeshStandardMaterial({ color: tile?.[1] || "#2b2633", roughness: 1, map: tile ? await blockTexture(tile[0], size) : null });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMaterial); floor.rotation.x = -Math.PI / 2; floor.position.y = -.025; floor.receiveShadow = options.shadows; group.add(floor);
      if (theme === "sky") {
        const stone = await surface("stone"); addBox(stone, 0, -.38, 0, size, .7, size); addBox(stone, 0, -1.1, 0, size * .65, .8, size * .65); addBox(stone, 0, -1.8, 0, size * .3, .7, size * .3);
      }
    }
    if (theme === "forest" || theme === "snow") {
      const wood = await surface(theme === "snow" ? "spruce_log" : "oak_log");
      const leaves = await surface(theme === "snow" ? "spruce_leaves" : "oak_leaves", theme === "snow" ? "#87a69b" : "#7f9d58", true);
      const spread = Math.max(2, size * .3);
      for (const [x, z, height] of [[-spread, -spread, 1.8], [spread, -spread, 2.1], [-spread, spread * .8, 1.6]]) {
        addBox(wood, x, height / 2, z, .42, height, .42);
        addBox(leaves, x, height + .2, z, 1.7, 1.1, 1.7); addBox(leaves, x, height + .9, z, 1.1, .7, 1.1);
      }
    }
    if (theme === "desert") {
      const sandstone = await surface("sand");
      const cactus = new THREE.MeshStandardMaterial({ color: "#3c6d44", roughness: 1 });
      for (const [x, z, h] of [[-size * .28, -size * .3, 1.8], [size * .32, -size * .25, 1.2]]) { addBox(cactus, x, h / 2, z, .65, h, .65); addBox(cactus, x + .45, h * .65, z, .45, .32, .32); }
      addBox(sandstone, size * .35, .18, size * .3, 1.5, .35, 1.5);
    }
    if (theme === "cave") {
      const stone = await surface("stone"), glow = await surface("glowstone");
      addBox(stone, 0, 1.6, -size / 2, size, 3.3, 1); addBox(stone, -size / 2, 1.6, 0, 1, 3.3, size);
      addBox(glow, -size * .35, .3, -size * .35, .6, .6, .6); addBox(glow, size * .3, .3, -size * .4, .6, .6, .6);
      const point = new THREE.PointLight("#ffd7a3", 8, size * 1.5, 2); point.position.set(-size * .35, .8, -size * .35); group.add(point);
    }
    if (theme === "nether") {
      const rock = await surface("netherrack"), glow = await surface("glowstone");
      for (const [x, z, h] of [[-size * .3, -size * .3, 2.4], [size * .3, -size * .3, 1.8]]) { addBox(rock, x, h / 2, z, 1, h, 1); addBox(glow, x, h + .2, z, .6, .4, .6); }
      const glowLight = new THREE.PointLight("#f76a31", 4, size * 1.8, 2); glowLight.position.set(0, .6, -size * .25); group.add(glowLight);
    }
    if (theme === "end") {
      const obsidian = await surface("obsidian");
      for (const x of [-size * .3, size * .3]) addBox(obsidian, x, 1.5, -size * .35, 1, 3, 1);
    }
    return group;
  } catch (error) {
    const geometry = new Set<THREE.BufferGeometry>(), surfaces = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    group.traverse(child => { if (child instanceof THREE.Mesh) { geometry.add(child.geometry); for (const material of Array.isArray(child.material) ? child.material : [child.material]) { surfaces.add(material); if (material instanceof THREE.MeshStandardMaterial && material.map) textures.add(material.map); } } });
    for (const result of await Promise.allSettled(materials.values())) if (result.status === "fulfilled") { surfaces.add(result.value); if (result.value.map) textures.add(result.value.map); }
    if (cube) geometry.add(cube); geometry.forEach(value => value.dispose()); surfaces.forEach(value => value.dispose()); textures.forEach(value => value.dispose()); throw error;
  }
}
