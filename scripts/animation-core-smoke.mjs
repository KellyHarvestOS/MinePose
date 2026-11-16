import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire, Module } from "node:module";
import ts from "typescript";
import { Euler, MathUtils, Quaternion } from "three";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url), cache = new Map(), checks = [], metrics = {};
const root = path.resolve("src/lib"), artifacts = path.resolve("artifacts/animation-core");
await mkdir(artifacts, { recursive: true });
function sourceModule(filename) {
  const resolved = filename.endsWith(".ts") ? filename : filename + ".ts";
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const module = new Module(resolved); cache.set(resolved, module);
  module.filename = resolved; module.paths = Module._nodeModulePaths(path.dirname(resolved));
  module.require = specifier => specifier.startsWith("./") ? sourceModule(path.resolve(path.dirname(resolved), specifier)) : specifier.startsWith("@/") ? require(path.resolve("src", specifier.slice(2))) : require(specifier);
  const compiled = ts.transpileModule(readFileSync(resolved, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  module._compile(compiled, resolved); return module.exports;
}
const engine = sourceModule(path.join(root, "animation"));
const types = sourceModule(path.join(root, "types"));
const { createAnimationProject, createCharacter, createGroup, createItem, createParticle, createCamera, upsertKeyframe, evaluateProject, vec, sampleKeyframes, easingProgress, applyAnimationPreset, parseAnimationProject, ANIMATION_PRESETS, poseToAnimationProject, animationFrameToPose } = engine;
const clone = value => structuredClone(value);
const near = (actual, expected, epsilon = 1e-7) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≠ ${expected}`);
const angle = value => new Quaternion().setFromEuler(new Euler(...[value.x, value.y, value.z].map(MathUtils.degToRad), "XYZ"));
function test(name, run) { run(); checks.push(name); console.log("PASS " + name); }
function rejects(edit, pattern = /./) { const project = createAnimationProject(); edit(project); assert.throws(() => parseAnimationProject(project), pattern); }
function key(time, value, easing = "linear", bezier) { return { id: crypto.randomUUID(), time, value, easing, bezier }; }
function rawTrack(project, objectId, property, keyframes, layerId = "base") { project.tracks.push({ id: crypto.randomUUID(), objectId, property, layerId, keyframes, muted: false, locked: false }); return project; }
function glb(json, binary) {
  const raw = Buffer.from(JSON.stringify(json)), jsonBytes = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(jsonBytes);
  const binaryBytes = binary ? Buffer.alloc(Math.ceil(binary.length / 4) * 4) : null; if (binary) binary.copy(binaryBytes);
  const bytes = Buffer.alloc(20 + jsonBytes.length + (binaryBytes ? 8 + binaryBytes.length : 0));
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(jsonBytes.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(bytes, 20);
  if (binaryBytes) { const offset = 20 + jsonBytes.length; bytes.writeUInt32LE(binaryBytes.length, offset); bytes.writeUInt32LE(0x004e4942, offset + 4); binaryBytes.copy(bytes, offset + 8); }
  return "data:model/gltf-binary;base64," + bytes.toString("base64");
}

test("All six templates round-trip through the versioned validator", () => {
  for (const template of ["empty", "walk", "combat", "dance", "cinematic", "gif"]) {
    const project = createAnimationProject(template), actual = parseAnimationProject(JSON.parse(JSON.stringify(project)));
    assert.equal(actual.name, project.name); assert.equal(actual.objects.length, project.objects.length); assert.equal(actual.tracks.length, project.tracks.length);
    assert.equal(actual.tracks.reduce((sum, track) => sum + track.keyframes.length, 0), project.tracks.reduce((sum, track) => sum + track.keyframes.length, 0));
  }
});

test("Independent character tracks interpolate at exact 0, 1 and 2 second keys without mutating source", () => {
  let project = createAnimationProject(); const first = project.objects.find(object => object.character), second = createCharacter("", true, "Второй персонаж"); project.objects.push(second);
  project = upsertKeyframe(project, first.id, "pose.rightArm", 1, vec(-80, 0, 10)); project = upsertKeyframe(project, first.id, "pose.rightArm", 2, vec(40, 0, -10));
  project = upsertKeyframe(project, second.id, "position", 0, vec(2, 0, 0)); project = upsertKeyframe(project, second.id, "position", 2, vec(4, 0, 0));
  const frozen = JSON.stringify(project), atOne = evaluateProject(project, 1), atTwo = evaluateProject(project, 2), halfway = evaluateProject(project, .5);
  near(atOne.find(object => object.id === second.id).transform.position.x, 3); near(atTwo.find(object => object.id === first.id).character.pose.rightArm.x, 40);
  assert.ok(halfway.find(object => object.id === first.id).character.pose.rightArm.x < -20); assert.equal(atOne.find(object => object.id === second.id).character.slim, true);
  assert.equal(JSON.stringify(project), frozen); assert.equal(project.tracks[0].keyframes.length, 3); assert.notStrictEqual(atOne.find(object => object.id === first.id).character.pose, first.character.pose);
  metrics.requiredScenarioKeyframes = project.tracks.reduce((sum, track) => sum + track.keyframes.length, 0);
});

test("Rotation takes the quaternion short path across ±180 degrees", () => {
  const keys = [key(0, vec(0, 170, 0)), key(2, vec(0, -170, 0))], midpoint = sampleKeyframes(keys, 1, "rotation");
  near(angle(midpoint).angleTo(angle(vec(0, 180, 0))), 0); assert.ok(angle(midpoint).angleTo(angle(vec())) > 3);
  const poseMidpoint = sampleKeyframes(keys, 1, "pose.head"); near(angle(poseMidpoint).angleTo(angle(midpoint)), 0);
});

test("Linear, step, ease-in/out and custom Bezier have correct values and endpoints", () => {
  near(easingProgress(.25, "linear"), .25); near(easingProgress(.25, "easeIn"), .0625); near(easingProgress(.25, "easeOut"), .4375); near(easingProgress(.5, "easeInOut"), .5);
  near(easingProgress(0, "bezier"), 0); near(easingProgress(1, "bezier"), 1); near(easingProgress(.5, "bezier", [.42, 0, .58, 1]), .5, 1e-5);
  assert.ok(easingProgress(.2, "bezier", [.1, 1.4, .2, 1.4]) > .8);
  assert.equal(sampleKeyframes([key(0, 0, "step"), key(2, 10)], 1.99, "opacity"), 0); assert.equal(sampleKeyframes([key(0, 0, "step"), key(2, 10)], 2, "opacity"), 10);
});

test("Parent, attachment and visibility remain discrete even with overshooting Bezier", () => {
  for (const [property, a, b] of [["parentId", "a", "b"], ["attachment", "rightArm", "leftArm"], ["visible", true, false]]) {
    const keys = [key(0, a, "bezier", [.1, 2, .2, 2]), key(2, b)];
    assert.equal(sampleKeyframes(keys, 1, property), a); assert.equal(sampleKeyframes(keys, 2, property), b);
  }
});

test("Layer weights, masks, mute and clip boundaries produce predictable independent channels", () => {
  let project = createAnimationProject(); const character = project.objects.find(value => value.character);
  project = upsertKeyframe(project, character.id, "position", 0, vec(2, 0, 0));
  project.layers.push({ id: "upper", name: "Верх", enabled: true, weight: .5, mask: ["head"], mode: "override" });
  rawTrack(project, character.id, "pose.head", [key(0, vec(60, 0, 0))], "upper"); rawTrack(project, character.id, "pose.leftLeg", [key(0, vec(70, 0, 0))], "upper"); rawTrack(project, character.id, "position", [key(0, vec(9, 0, 0))], "upper");
  let evaluated = evaluateProject(project, .5).find(value => value.id === character.id); near(evaluated.character.pose.head.x, 30); near(evaluated.character.pose.leftLeg.x, 0); near(evaluated.transform.position.x, 2);
  project = clone(project); project.layers.push({ id: "add", name: "Добавка", enabled: true, weight: .5, mask: "all", mode: "additive" });
  rawTrack(project, character.id, "position", [key(0, vec(4, 0, 0))], "add"); rawTrack(project, character.id, "pose.head", [key(0, vec(20, 0, 0))], "add");
  evaluated = evaluateProject(project, .5).find(value => value.id === character.id); near(evaluated.transform.position.x, 4); near(evaluated.character.pose.head.x, 40);
  project = clone(project); project.tracks.at(-2).muted = true; project.tracks.at(-1).start = 1; project.tracks.at(-1).end = 2;
  evaluated = evaluateProject(project, .5).find(value => value.id === character.id); near(evaluated.transform.position.x, 2); near(evaluated.character.pose.head.x, 30);
});

test("Key insertion is frame-quantized, replaces existing keys, seeds frame zero and honors track locks", () => {
  let project = createAnimationProject(); const character = project.objects.find(value => value.character);
  project = upsertKeyframe(project, character.id, "position", .502, vec(1, 0, 0)); assert.equal(project.tracks[0].keyframes.length, 2); assert.equal(project.tracks[0].keyframes[1].time, .5);
  const before = JSON.stringify(project), previous = project;
  project = upsertKeyframe(project, character.id, "position", .5, vec(2, 0, 0)); assert.equal(project.tracks[0].keyframes.length, 2); assert.equal(project.tracks[0].keyframes[1].value.x, 2); assert.equal(JSON.stringify(previous), before); assert.notStrictEqual(project.tracks[0].keyframes[1], previous.tracks[0].keyframes[1]);
  project.tracks[0].locked = true; assert.strictEqual(upsertKeyframe(project, character.id, "position", 1, vec(9, 0, 0)), project);
});

test("All 44 presets produce real finite tracks and preserve another character's keys", () => {
  assert.equal(ANIMATION_PRESETS.length, 44); assert.equal(new Set(ANIMATION_PRESETS.map(value => value.id)).size, 44);
  const signatures = new Map();
  for (const preset of ANIMATION_PRESETS) {
    let project = createAnimationProject(); const character = project.objects.find(object => object.character), other = createCharacter(); project.objects.push(other);
    project = upsertKeyframe(project, other.id, "position", 1, vec(5, 0, 0)); const previous = JSON.stringify(project.tracks[0]);
    project = applyAnimationPreset(project, character.id, preset.id, .5, preset.duration);
    parseAnimationProject(project); assert.equal(JSON.stringify(project.tracks[0]), previous); assert.ok(project.tracks.filter(track => track.objectId === character.id).every(track => track.keyframes.length === 25));
    const frames = [.1, .29, .52, .79].map(fraction => evaluateProject(project, .5 + fraction * preset.duration).find(object => object.id === character.id));
    const signature = createHash("sha256").update(JSON.stringify(frames.map(object => ({ pose: object.character.pose, transform: object.transform })))).digest("hex");
    const equal = signatures.get(signature) || []; equal.push(preset.id); signatures.set(signature, equal);
    for (const frame of frames) for (const part of Object.values(frame.character.pose)) for (const value of Object.values(part)) assert.ok(Number.isFinite(value));
  }
  metrics.presetCount = ANIMATION_PRESETS.length; metrics.uniquePresetTrajectories = signatures.size; metrics.duplicatePresetTrajectories = [...signatures.values()].filter(value => value.length > 1);
  assert.equal(signatures.size, 44, `Повторяющиеся движения: ${JSON.stringify(metrics.duplicatePresetTrajectories)}`);
});

test("Pose import and frame export preserve custom skin, slim rig, root transform and both held items", () => {
  const pose = types.makeProject("Мой кадр"); pose.scene.slim = true; pose.scene.modelPosition = vec(2, .4, -1); pose.scene.modelRotation = vec(0, 35, 0); pose.pose.rightArm.x = -70;
  pose.scene.items = { right: { id: "diamond_sword", transform: { position: vec(.1, .2, .3), rotation: vec(15, 20, 25), scale: .8 } }, left: { id: "shield", transform: { position: vec(-.1, .4, .2), rotation: vec(-5, 10, 30), scale: 1.2 } } };
  const project = poseToAnimationProject(pose), character = project.objects.find(value => value.character), restored = animationFrameToPose(project, 0, character.id);
  assert.deepEqual(restored.pose, pose.pose); assert.equal(restored.scene.slim, true); assert.deepEqual(restored.scene.modelPosition, pose.scene.modelPosition); assert.deepEqual(restored.scene.modelRotation, pose.scene.modelRotation); assert.deepEqual(restored.scene.items, pose.scene.items);
});

test("Malformed schema, unknown assets, invalid tracks and unsafe numeric values are rejected", () => {
  rejects(project => { project.schemaVersion = 2; }); rejects(project => { project.objects[0].transform.position.x = NaN; }); rejects(project => { project.objects[0].transform.scale.x = 0; });
  rejects(project => { project.objects.push(clone(project.objects[0])); }); rejects(project => { project.duration = Infinity; }); rejects(project => { project.fps = 25; });
  rejects(project => { project.export.width = 1920.5; }); rejects(project => { project.export.cameraId = "missing"; }); rejects(project => { project.layers = []; });
  rejects(project => { const item = createItem("diamond_sword"); item.item.catalogId = "unavailable"; project.objects.push(item); });
  rejects(project => { project.objects[0].character.skin = "https://external.example/skin.png"; }); rejects(project => { project.objects[0].character.skin = "data:image/png;base64,iVBORw0KGgoAAAA="; });
  rejects(project => rawTrack(project, project.objects[0].id, "camera.fov", [key(0, 45)])); rejects(project => rawTrack(project, project.objects[1].id, "camera.fov", [key(0, -1)]));
  rejects(project => rawTrack(project, project.objects[0].id, "attachment", [key(0, "unknown")])); rejects(project => rawTrack(project, project.objects[0].id, "position", [key(0, vec()), key(0, vec(2))]));
  rejects(project => rawTrack(project, project.objects[0].id, "position", [key(9, vec())])); rejects(project => rawTrack(project, project.objects[0].id, "opacity", [key(0, .5, "bezier", [-1, 0, 1, 1])]));
});

test("Static and animated hierarchy cycles are rejected while non-overlapping reparenting remains valid", () => {
  rejects(project => { const a = createGroup(), b = createGroup(); a.parentId = b.id; b.parentId = a.id; project.objects.push(a, b); });
  rejects(project => { project.objects[0].parentId = "missing"; });
  rejects(project => { const a = createGroup(), b = createGroup(); project.objects.push(a, b); rawTrack(project, a.id, "parentId", [key(0, ""), key(1, b.id)]); rawTrack(project, b.id, "parentId", [key(0, ""), key(2, a.id)]); });
  let project = createAnimationProject(); const a = createGroup(), b = createGroup(); project.objects.push(a, b);
  rawTrack(project, a.id, "parentId", [key(0, b.id), key(1, "")]); rawTrack(project, b.id, "parentId", [key(0, ""), key(2, a.id)]); parseAnimationProject(project);
  project = clone(project); project.tracks[0].end = .5; project.tracks[1].keyframes[1].time = 1; parseAnimationProject(project);
});

test("GLB import accepts embedded GLTF2 and rejects external assets, corrupt chunks and unsupported compression", () => {
  const model = dataUrl => { const object = createGroup(); object.type = "model"; object.model = { dataUrl }; return object; };
  const simple = glb({ asset: { version: "2.0" }, scenes: [{ nodes: [] }], scene: 0 });
  let project = createAnimationProject(); project.objects.push(model(simple)); assert.equal(parseAnimationProject(project).objects.at(-1).model.dataUrl, simple);
  project = createAnimationProject(); project.objects.push(model(glb({ asset: { version: "2.0" }, buffers: [{ byteLength: 4 }], scenes: [{ nodes: [] }] }, Buffer.alloc(4)))); parseAnimationProject(project);
  for (const json of [{ asset: { version: "2.0" }, buffers: [{ byteLength: 4, uri: "https://external.example/data.bin" }] }, { asset: { version: "2.0" }, images: [{ uri: "../texture.png" }] }, { asset: { version: "2.0" }, extensionsRequired: ["KHR_draco_mesh_compression"] }, { asset: { version: "1.0" } }]) rejects(project => project.objects.push(model(glb(json))), /GLB/);
  rejects(project => project.objects.push(model("data:model/gltf-binary;base64," + Buffer.from("not a GLB file").toString("base64"))), /GLB/);
  const bytes = Buffer.from(simple.split(",")[1], "base64"); bytes.writeUInt32LE(999999, 12); rejects(project => project.objects.push(model("data:model/gltf-binary;base64," + bytes.toString("base64"))), /GLB/);
});

const transpileBrowser = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/(from\s+["'])([^"']+)(["'])/g, (full, before, specifier, after) => {
  if (specifier.startsWith("./")) return before + specifier + ".js" + after;
  if (specifier === "@/data/item-catalog.json") return before + "/catalog.js" + after;
  return full;
});
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  if (pathname === "/") { response.setHeader("content-type", "text/html"); response.end("<!doctype html><title>Animation persistence verification</title>"); return; }
  if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  response.setHeader("content-type", "text/javascript");
  if (pathname === "/catalog.js") { response.end("export default " + readFileSync("src/data/item-catalog.json", "utf8")); return; }
  if (/^\/[a-z-]+\.js$/.test(pathname)) { try { response.end(transpileBrowser(readFileSync(path.join(root, pathname.slice(1, -3) + ".ts"), "utf8"))); return; } catch { } }
  response.writeHead(404); response.end();
});
let browser;
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage(), errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  let project = createAnimationProject("walk"); const character = project.objects.find(value => value.character); project = upsertKeyframe(project, character.id, "pose.rightArm", 1, vec(-80, 0, 0)); project = upsertKeyframe(project, character.id, "pose.rightArm", 2, vec(50, 0, 0));
  const previous = JSON.stringify(parseAnimationProject(project));
  await page.evaluate(async project => { const store = await import("/animation-storage.js"); await store.saveAnimationDraft(project); const all = await store.listAnimationProjects(); if (all.length !== 1) throw new Error("Draft not saved atomically to projects"); }, project);
  await page.reload();
  const restored = await page.evaluate(async id => { const store = await import("/animation-storage.js"); const project = await store.loadAnimationProject(id), draft = await store.loadAnimationDraft(); return { project, draft }; }, project.id);
  assert.equal(JSON.stringify(restored.project), previous); assert.equal(JSON.stringify(restored.draft), previous); checks.push("IndexedDB draft and project survive a full reload without losing keyframes"); console.log("PASS " + checks.at(-1));
  await page.evaluate(async id => { const store = await import("/animation-storage.js"); const project = await store.loadAnimationProject(id); await store.saveSceneTemplate("Моя сцена", project); const scene = (await store.loadSceneTemplates())[0]; if (scene.objects.some(object => object.character || object.audio)) throw new Error("Scene stores character/audio unexpectedly"); await store.deleteAnimationProject(id); if ((await store.listAnimationProjects()).length || await store.loadAnimationDraft()) throw new Error("Delete did not remove project and matching draft"); }, project.id);
  checks.push("Scene templates omit characters/audio and deletion atomically clears matching drafts"); console.log("PASS " + checks.at(-1)); assert.deepEqual(errors, []);
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: checks.length, checks, metrics }, null, 2)); console.log(JSON.stringify({ passed: checks.length, metrics }, null, 2));
} finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
