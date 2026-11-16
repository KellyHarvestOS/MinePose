import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3025", artifacts = path.resolve("artifacts/animation-advanced");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1680, height: 1200 }, locale: "ru-RU" }), page = await context.newPage(), checks = [], errors = [], consoleErrors = [], metrics = {};
page.setDefaultTimeout(30000); page.on("pageerror", error => errors.push(error.stack || error.message)); page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const button = name => page.getByRole("button", { name, exact: true });
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function ready() { await expect(page.locator(".av-viewport canvas")).toBeVisible(); await expect(page.locator(".as-stage-loading")).toHaveCount(0); }
async function project() { return page.evaluate(async () => { const db = await new Promise((resolve, reject) => { const request = indexedDB.open("minepose-animation-studio-v1"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); try { return await new Promise((resolve, reject) => { const request = db.transaction("meta").objectStore("meta").get("draft"); request.onsuccess = () => resolve(request.result?.project); request.onerror = () => reject(request.error); }); } finally { db.close(); } }); }
async function save() { await page.locator(".as-topbar").getByRole("button", { name: "Сохранить", exact: true }).click(); await expect(page.locator(".as-save-state")).toHaveText("Сохранено"); return project(); }
async function seek(time) { await page.getByRole("spinbutton", { name: "Текущее время анимации", exact: true }).fill(String(time)); await page.locator(".as-stage-tools").click({ position: { x: 5, y: 5 } }); }
async function key(time) { return page.getByRole("button", { name: `Ключ Персонаж, Правая рука, ${time.toFixed(2)} секунды`, exact: true }); }
async function hash() { return createHash("sha256").update(await page.locator(".av-viewport canvas").evaluate(canvas => canvas.toDataURL())).digest("hex"); }
async function fillRange(label, value) { await page.getByRole("slider", { name: label, exact: true }).fill(String(value)); }
function wav() { const rate = 8000, count = rate * 2, buffer = Buffer.alloc(44 + count * 2); buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(count * 2, 40); for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 440 / rate) * 10000), 44 + i * 2); return buffer; }

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: "Анимации", exact: true }).click();
  await button("Создать свой проект").click(); await ready(); await page.getByRole("textbox", { name: "Название анимации", exact: true }).fill("Advanced QA"); await button("Продвинутый").click();
  await step("Timeline keys support drag, multi-selection, copy, paste, duplication and deletion", async () => {
    await button("Правая рука").click(); await seek(1); await page.getByRole("spinbutton", { name: "Вращение части тела X", exact: true }).fill("-80"); await button("Ключ").click();
    await seek(2); await page.getByRole("spinbutton", { name: "Вращение части тела X", exact: true }).fill("35"); await button("Ключ").click();
    let state = await save(); assert.deepEqual(state.tracks.find(track => track.property === "pose.rightArm").keyframes.map(key => key.time), [0, 1, 2]);
    const drag = await (await key(1)).boundingBox(); await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2); await page.mouse.down(); await page.mouse.move(drag.x + drag.width / 2 + 43, drag.y + drag.height / 2, { steps: 8 }); await page.mouse.up();
    state = await save(); assert.deepEqual(state.tracks.find(track => track.property === "pose.rightArm").keyframes.map(key => key.time), [0, 1.5, 2]);
    await (await key(1.5)).click(); await (await key(2)).click({ modifiers: ["Shift"] }); await expect(page.locator(".as-keyframe.is-selected")).toHaveCount(2);
    await button("Копировать ключи").click(); await seek(2.5); await button("Вставить ключи").click(); state = await save(); assert.deepEqual(state.tracks.find(track => track.property === "pose.rightArm").keyframes.map(key => key.time), [0, 1.5, 2, 2.5, 3]);
    await (await key(3)).click(); await button("Дублировать ключи").click(); state = await save(); assert.ok(state.tracks.find(track => track.property === "pose.rightArm").keyframes.some(key => Math.abs(key.time - 3 - 1 / 30) < 1e-7));
    await button("Удалить выбранные ключи").click(); state = await save(); assert.ok(!state.tracks.find(track => track.property === "pose.rightArm").keyframes.some(key => key.time === 3));
    metrics.timelineKeys = state.tracks.find(track => track.property === "pose.rightArm").keyframes.length;
  });
  await step("The Bezier editor edits the selected key and its handles", async () => {
    await (await key(1.5)).click(); await button("Кривые").click(); await page.getByRole("combobox", { name: "Интерполяция ключевого кадра", exact: true }).selectOption("bezier");
    await page.getByRole("spinbutton", { name: "Bezier X1", exact: true }).fill("0.15"); await page.getByRole("spinbutton", { name: "Bezier Y1", exact: true }).fill("0.8");
    const handle = page.locator(".as-graph-editor circle").first(), box = await handle.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 9, { steps: 5 }); await page.mouse.up();
    let state = await save(); const selected = state.tracks.find(track => track.property === "pose.rightArm").keyframes.find(key => key.time === 1.5); assert.equal(selected.easing, "bezier"); assert.ok(selected.bezier[0] > .15); assert.ok(selected.bezier[1] < .8); metrics.bezier = selected.bezier;
    await button("Копировать ключи").click(); await seek(3.5); await button("Вставить ключи").click(); state = await save(); const copied = state.tracks.find(track => track.property === "pose.rightArm").keyframes.find(key => key.time === 3.5); assert.equal(copied.easing, "bezier"); assert.deepEqual(copied.bezier, selected.bezier);
  });
  await step("Preset layers have working weight, mask, mode and bake controls", async () => {
    await seek(0); await page.getByRole("combobox", { name: "Готовая анимация", exact: true }).selectOption("wave"); await page.locator(".as-preset-length").getByRole("button", { name: "Добавить", exact: true }).click(); await button("Слои").click();
    await fillRange("Вес слоя Машет рукой", .4); await page.getByRole("combobox", { name: "Смешивание слоя Машет рукой", exact: true }).selectOption("additive");
    const layer = page.locator(".as-layer").filter({ has: page.getByRole("slider", { name: "Вес слоя Машет рукой", exact: true }) }); await layer.locator("summary").click(); await layer.getByRole("checkbox", { name: "Голова", exact: true }).uncheck();
    let state = await save(), value = state.layers.find(value => value.name === "Машет рукой"); assert.equal(value.weight, .4); assert.equal(value.mode, "additive"); assert.ok(!value.mask.includes("head")); assert.ok(value.mask.includes("rightArm"));
    await page.getByRole("checkbox", { name: "Включить слой Машет рукой", exact: true }).uncheck(); state = await save(); assert.equal(state.layers.find(value => value.name === "Машет рукой").enabled, false);
    await button("Запечь слои в ключи").click(); await expect(button("Запечь слои в ключи")).toBeEnabled(); state = await save(); assert.equal(state.layers.length, 1); assert.equal(state.layers[0].name, "Запечённая анимация"); assert.ok(state.tracks.every(track => track.keyframes.length === 121)); metrics.bakedTracks = state.tracks.length;
  });
  await step("A real catalog item attaches to a hand and detaches through animated parent keys", async () => {
    await button("Свойства").click(); await page.locator(".as-tree-name").filter({ hasText: "Персонаж" }).first().click(); await button("Предмет").click();
    await page.getByRole("textbox", { name: "Поиск предметов анимации", exact: true }).fill("diamond_sword"); await page.getByRole("combobox", { name: "Крепление нового предмета", exact: true }).selectOption("rightArm"); await button("Добавить в анимацию: Алмазный меч").click(); await ready();
    let state = await save(), item = state.objects.find(object => object.item?.catalogId === "diamond_sword"); assert.ok(item.parentId); assert.equal(item.attachment, "rightArm");
    await seek(1); await button("Отсоединить в текущем кадре").click(); state = await save(); const parentTrack = state.tracks.find(track => track.objectId === item.id && track.property === "parentId"); assert.deepEqual(parentTrack.keyframes.map(key => [key.time, key.value]), [[0, item.parentId], [1, ""]]); assert.ok(state.tracks.some(track => track.objectId === item.id && track.property === "position")); metrics.detachedItemTracks = state.tracks.filter(track => track.objectId === item.id).length;
  });
  await step("Uploaded audio produces a real waveform and retains trim, volume, fades and mute settings", async () => {
    await page.getByLabel("Аудио анимации", { exact: true }).setInputFiles({ name: "qa-tone.wav", mimeType: "audio/wav", buffer: wav() });
    await expect(page.getByRole("img", { name: "Звуковая волна", exact: true })).toBeVisible();
    for (const [field, value] of [["offset", .5], ["trimStart", .2], ["trimEnd", 1.7], ["volume", .45], ["fadeIn", .15], ["fadeOut", .3]]) await page.getByRole("spinbutton", { name: `Аудио: ${field}`, exact: true }).fill(String(value));
    await page.getByRole("checkbox", { name: "Отключить дорожку", exact: true }).check(); const state = await save(), sound = state.objects.find(object => object.audio).audio; assert.equal(sound.peaks.length, 256); assert.ok(sound.peaks.some(value => value > .1)); assert.equal(sound.duration, 2); assert.equal(sound.trimStart, .2); assert.equal(sound.trimEnd, 1.7); assert.equal(sound.volume, .45); assert.equal(sound.muted, true); assert.equal(sound.offset, .5); metrics.audioPeaks = sound.peaks.length;
  });
  await step("Environments switch the real scene and custom scene templates keep valid camera references", async () => {
    await button("Сцена").click(); const initial = await hash(); await page.getByRole("combobox", { name: "Окружение анимации", exact: true }).selectOption("desert"); await ready(); await expect.poll(hash).not.toBe(initial); const desert = await hash();
    await page.getByRole("combobox", { name: "Окружение анимации", exact: true }).selectOption("snow"); await ready(); await expect.poll(hash).not.toBe(desert);
    page.once("dialog", dialog => dialog.accept("QA scene")); await button("Сохранить сцену в шаблоны").click(); await page.getByRole("combobox", { name: "Мои сцены анимации", exact: true }).selectOption({ label: "QA scene" }); await ready(); const state = await save();
    assert.equal(state.scene.environment, "snow"); assert.ok(state.objects.some(object => object.id === state.scene.activeCameraId && object.camera)); assert.ok(state.objects.some(object => object.id === state.export.cameraId && object.camera)); assert.ok(state.tracks.every(track => state.objects.some(object => object.id === track.objectId))); metrics.savedObjects = state.objects.length;
  });
  await page.screenshot({ path: path.join(artifacts, "advanced-studio.png"), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: checks.length, checks, metrics, errors, consoleErrors }, null, 2)); console.log(JSON.stringify({ passed: checks.length, metrics }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {}); await writeFile(path.join(artifacts, "failure.json"), JSON.stringify({ checks, metrics, errors, consoleErrors, error: error.stack || String(error) }, null, 2)); throw error; } finally { await browser.close(); }

