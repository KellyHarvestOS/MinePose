/** Extracts data and textures only. The official client archive is never executed. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

const VERSION = "1.21.5";
const SHA1 = "b88808bbb3da8d9f453694b5d8f74a3396f1a533";
const SOURCE = `https://piston-data.mojang.com/v1/objects/${SHA1}/client.jar`;
const archiveArgument = process.argv.indexOf("--archive");
const zip = archiveArgument >= 0
  ? await fs.readFile(process.argv[archiveArgument + 1])
  : Buffer.from(await (async () => { const response = await fetch(SOURCE); if (!response.ok) throw new Error(`Download failed: ${response.status}`); return response.arrayBuffer(); })());
if (createHash("sha1").update(zip).digest("hex") !== SHA1) throw new Error("Minecraft archive integrity check failed");
let end = -1;
for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) if (zip.readUInt32LE(p) === 0x06054b50) { end = p; break; }
if (end < 0) throw new Error("Missing ZIP directory");
let cursor = zip.readUInt32LE(end + 16);
const entries = new Map();
for (let index = 0; index < zip.readUInt16LE(end + 10); index++) {
  const method = zip.readUInt16LE(cursor + 10), size = zip.readUInt32LE(cursor + 20), nameLength = zip.readUInt16LE(cursor + 28), extra = zip.readUInt16LE(cursor + 30), comment = zip.readUInt16LE(cursor + 32), offset = zip.readUInt32LE(cursor + 42);
  const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength); cursor += 46 + nameLength + extra + comment;
  entries.set(name, { method, size, offset });
}
function read(name, optional = false) {
  const e = entries.get(name);
  if (!e) { if (optional) return undefined; throw new Error(`Archive entry missing: ${name}`); }
  const start = e.offset + 30 + zip.readUInt16LE(e.offset + 26) + zip.readUInt16LE(e.offset + 28);
  const bytes = zip.subarray(start, start + e.size);
  if (e.method !== 0 && e.method !== 8) throw new Error("Unsupported ZIP compression");
  return e.method === 8 ? inflateRawSync(bytes) : bytes;
}
const json = name => JSON.parse(read(name).toString("utf8"));
const languageArgument = process.argv.indexOf("--language");
let language;
if (languageArgument >= 0) language = JSON.parse(await fs.readFile(process.argv[languageArgument + 1], "utf8"));
else {
  const requestJSON = async url => { const response = await fetch(url); if (!response.ok) throw new Error(`Download failed: ${response.status}`); return response.json(); };
  const manifest = await requestJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const release = manifest.versions.find(entry => entry.id === VERSION);
  const metadata = await requestJSON(release.url);
  const assetIndex = await requestJSON(metadata.assetIndex.url);
  const languageHash = assetIndex.objects["minecraft/lang/ru_ru.json"].hash;
  const languageResponse = await fetch(`https://resources.download.minecraft.net/${languageHash.slice(0, 2)}/${languageHash}`);
  if (!languageResponse.ok) throw new Error(`Language download failed: ${languageResponse.status}`);
  const bytes = Buffer.from(await languageResponse.arrayBuffer());
  if (createHash("sha1").update(bytes).digest("hex") !== languageHash) throw new Error("Language integrity check failed");
  language = JSON.parse(bytes.toString("utf8"));
  await fs.mkdir("artifacts", { recursive: true });
  await fs.writeFile(`artifacts/minecraft-ru-ru-${VERSION}.json`, bytes);
}
const catalogs = {
  diamond: "diamond_sword diamond_pickaxe diamond_axe diamond_shovel diamond_hoe diamond diamond_block diamond_helmet diamond_chestplate diamond_leggings diamond_boots",
  netherite: "netherite_sword netherite_pickaxe netherite_axe netherite_shovel netherite_hoe netherite_ingot netherite_scrap netherite_block netherite_helmet netherite_chestplate netherite_leggings netherite_boots",
  tools: "wooden_sword wooden_pickaxe wooden_axe wooden_shovel wooden_hoe stone_sword stone_pickaxe stone_axe stone_shovel stone_hoe iron_sword iron_pickaxe iron_axe iron_shovel iron_hoe golden_sword golden_pickaxe golden_axe golden_shovel golden_hoe bow crossbow trident mace shield arrow spectral_arrow tipped_arrow fishing_rod shears flint_and_steel brush carrot_on_a_stick warped_fungus_on_a_stick iron_helmet iron_chestplate iron_leggings iron_boots golden_helmet golden_chestplate golden_leggings golden_boots turtle_helmet",
  blocks: "dirt grass_block coarse_dirt rooted_dirt podzol mycelium mud packed_mud stone cobblestone mossy_cobblestone smooth_stone granite diorite andesite deepslate cobbled_deepslate tuff calcite obsidian crying_obsidian bedrock gold_block iron_block emerald_block copper_block lapis_block redstone_block coal_block quartz_block amethyst_block raw_iron_block raw_gold_block raw_copper_block tnt crafting_table furnace blast_furnace smoker chest ender_chest barrel bookshelf chiseled_bookshelf oak_planks spruce_planks birch_planks jungle_planks acacia_planks dark_oak_planks mangrove_planks cherry_planks bamboo_planks pale_oak_planks crimson_planks warped_planks oak_log spruce_log birch_log jungle_log acacia_log dark_oak_log mangrove_log cherry_log pale_oak_log crimson_stem warped_stem stripped_oak_log glass tinted_glass white_stained_glass purple_stained_glass light_blue_stained_glass glowstone sea_lantern shroomlight redstone_lamp sand red_sand gravel sandstone red_sandstone bricks stone_bricks mossy_stone_bricks cracked_stone_bricks nether_bricks red_nether_bricks netherrack soul_sand soul_soil blackstone gilded_blackstone polished_blackstone end_stone end_stone_bricks purpur_block prismarine dark_prismarine prismarine_bricks ice packed_ice blue_ice snow_block clay terracotta white_terracotta purple_terracotta honey_block slime_block sponge wet_sponge dried_kelp_block hay_block bone_block moss_block pumpkin carved_pumpkin jack_o_lantern melon white_wool purple_wool magenta_wool black_wool white_concrete purple_concrete black_concrete white_concrete_powder purple_concrete_powder oak_leaves spruce_leaves birch_leaves azalea_leaves flowering_azalea_leaves red_mushroom_block brown_mushroom_block mushroom_stem beehive bee_nest target note_block jukebox enchanting_table stonecutter anvil bell lantern soul_lantern chain iron_bars ladder lever torch redstone_torch repeater comparator hopper dispenser dropper observer piston sticky_piston beacon respawn_anchor lodestone ancient_debris diamond_ore deepslate_diamond_ore emerald_ore iron_ore gold_ore coal_ore lapis_ore redstone_ore nether_quartz_ore nether_gold_ore copper_ore",
  food: "apple golden_apple enchanted_golden_apple bread carrot golden_carrot potato baked_potato poisonous_potato beetroot beetroot_soup mushroom_stew rabbit_stew suspicious_stew sweet_berries glow_berries chorus_fruit dried_kelp beef cooked_beef porkchop cooked_porkchop mutton cooked_mutton chicken cooked_chicken rabbit cooked_rabbit cod cooked_cod salmon cooked_salmon tropical_fish pufferfish rotten_flesh spider_eye cake cookie melon_slice pumpkin_pie honey_bottle milk_bucket egg sugar wheat cocoa_beans",
  special: "totem_of_undying ender_pearl ender_eye nether_star elytra potion splash_potion lingering_potion experience_bottle compass recovery_compass clock map filled_map book writable_book written_book enchanted_book firework_rocket firework_star water_bucket lava_bucket powder_snow_bucket bucket amethyst_shard emerald lapis_lazuli redstone quartz echo_shard heart_of_the_sea nautilus_shell trial_key ominous_trial_key breeze_rod blaze_rod blaze_powder ghast_tear slime_ball magma_cream gunpowder glowstone_dust dragon_breath wind_charge end_crystal music_disc_cat music_disc_pigstep name_tag saddle lead spyglass bundle rabbit_foot rabbit_hide leather feather string flint coal charcoal iron_ingot gold_ingot copper_ingot iron_nugget gold_nugget raw_iron raw_gold raw_copper bone bone_meal snowball",
};
const special = { shield: "shield", trident: "trident", chest: "chest", ender_chest: "ender_chest" };
const specialEntity = { shield: "entity/shield_base_nopattern", trident: "entity/trident", chest: "entity/chest/normal", ender_chest: "entity/chest/ender" };
const modelCache = new Map();
const namespace = value => value.replace(/^minecraft:/, "");
function resolveModel(name, stack = []) {
  name = namespace(name);
  if (modelCache.has(name)) return structuredClone(modelCache.get(name));
  if (stack.includes(name)) throw new Error(`Model parent cycle: ${name}`);
  if (name === "builtin/generated") return { generated: true, textures: {}, display: {} };
  if (name === "builtin/entity") return { textures: {}, display: {} };
  const own = json(`assets/minecraft/models/${name}.json`);
  const parent = own.parent ? resolveModel(own.parent, [...stack, name]) : { textures: {}, display: {} };
  const resolved = { ...parent, ...own, textures: { ...parent.textures, ...own.textures }, display: { ...parent.display, ...own.display } };
  delete resolved.parent;
  modelCache.set(name, resolved);
  return structuredClone(resolved);
}
function chooseModel(node) {
  if (!node) return undefined;
  if (node.type === "minecraft:model") return node.model;
  if (node.type === "minecraft:special") return node.base;
  if (node.fallback) return chooseModel(node.fallback);
  if (node.on_false) return chooseModel(node.on_false);
  if (node.entries?.length) return chooseModel(node.entries[0].model);
  if (node.models?.length) return chooseModel(node.models[0]);
  if (node.cases?.length) return chooseModel(node.cases[0].model);
  return undefined;
}
const exported = new Set();
async function texture(value, map, seen = []) {
  if (value.startsWith("#")) {
    const key = value.slice(1);
    if (seen.includes(key) || !map[key]) throw new Error(`Unresolved texture: ${value}`);
    return texture(map[key], map, [...seen, key]);
  }
  const name = namespace(value);
  if (!/^[a-z0-9_/]+$/.test(name)) throw new Error(`Invalid texture name: ${name}`);
  const relative = `minecraft/textures/${name}.png`;
  if (!exported.has(name)) {
    const bytes = read(`assets/minecraft/textures/${name}.png`);
    const destination = path.join("public", relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
    const metadata = read(`assets/minecraft/textures/${name}.png.mcmeta`, true);
    if (metadata) await fs.writeFile(`${destination}.mcmeta`, metadata);
    exported.add(name);
  }
  return `/${relative}`;
}
await fs.mkdir("public/minecraft/models", { recursive: true });
await fs.mkdir("src/data", { recursive: true });
const catalog = [], skipped = [];
for (const [category, list] of Object.entries(catalogs)) for (const id of list.split(" ")) {
  const definitionBytes = read(`assets/minecraft/items/${id}.json`, true);
  if (!definitionBytes) { skipped.push(id); continue; }
  const definition = JSON.parse(definitionBytes);
  const name = language[`item.minecraft.${id}`] || language[`block.minecraft.${id}`];
  if (!name) throw new Error(`Missing official Russian name: ${id}`);
  let modelName = id === "trident" ? "item/trident_in_hand" : chooseModel(definition.model);
  if (id === "cake") modelName = "block/cake";
  if (!modelName) throw new Error(`No static model for ${id}`);
  const source = resolveModel(modelName);
  const textures = {};
  for (const [key, value] of Object.entries(source.textures)) textures[key] = await texture(value, source.textures);
  if (specialEntity[id]) textures.entity = await texture(specialEntity[id], source.textures);
  if (["enchanted_golden_apple", "enchanted_book"].includes(id)) textures.glint = await texture("misc/enchanted_glint_item", source.textures);
  const model = { kind: special[id] ? "special" : source.elements ? "elements" : "generated", textures, display: source.display };
  if (special[id]) model.special = special[id];
  else if (source.elements) model.elements = source.elements;
  else model.layers = Object.keys(textures).filter(key => /^layer\d+$/.test(key)).sort().map(key => textures[key]);
  if (["potion", "splash_potion", "lingering_potion", "tipped_arrow"].includes(id)) model.tints = ["#385dc6"];
  if (/grass_block|leaves/.test(id)) model.tints = ["#91bd59"];
  if (id === "filled_map") model.tints = ["#ffffff", "#464f2e"];
  if (id === "firework_star") model.tints = ["#bf7aef"];
  if (!model.elements?.length && !model.layers?.length && !model.special) throw new Error(`Empty model for ${id}`);
  await fs.writeFile(`public/minecraft/models/${id}.json`, JSON.stringify(model));
  const icon = id === "trident" ? await texture("item/trident", source.textures) : textures.layer0 || textures.front || textures.side || textures.all || textures.particle || textures.entity || Object.values(textures)[0];
  if (!icon) throw new Error(`No icon for ${id}`);
  catalog.push({ id, name, category, model: `/minecraft/models/${id}.json`, icon, keywords: [id.replaceAll("_", " "), ...(id.includes("golden") ? ["золотой"] : [])] });
}
await fs.writeFile("src/data/item-catalog.json", JSON.stringify(catalog, null, 2) + "\n");
await fs.writeFile("public/minecraft/SOURCE.txt", `Minecraft Java Edition ${VERSION}\nModels, item definitions and textures extracted from the official Mojang client archive.\nRussian names from the official ru_ru.json language asset, downloaded through the version's Mojang asset index.\nCopyright Mojang AB / Microsoft.\nSource: ${SOURCE}\nSHA-1: ${SHA1}\nThe archive is read only as ZIP data, never executed or distributed by this project.\nModel parent chains and texture references are resolved by scripts/extract-minecraft-items.mjs.\nSpecial entity models use the original shield, trident and chest atlases.\n`);
console.log(JSON.stringify({ version: VERSION, items: catalog.length, textures: exported.size, categories: Object.fromEntries(Object.keys(catalogs).map(category => [category, catalog.filter(item => item.category === category).length])), skipped }, null, 2));
