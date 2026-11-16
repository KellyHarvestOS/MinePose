import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts/animation-template-library");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1660, height: 1120 }, locale: "ru-RU", deviceScaleFactor: 1 });
await context.addInitScript(() => {
  const original = HTMLCanvasElement.prototype.getContext, seen = new WeakSet();
  window.__templateWebGL = { created: 0, lost: 0, records: [] };
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const value = Reflect.apply(original, this, [type, ...args]);
    if (["webgl", "webgl2", "experimental-webgl"].includes(type) && value && !seen.has(value)) {
      seen.add(value); window.__templateWebGL.created++;
      window.__templateWebGL.records.push({ stack: new Error().stack.split("\n").slice(0, 8).join("\n"), label: this.getAttribute("aria-label"), library: !!document.querySelector(".atl-library") });
      this.addEventListener("webglcontextlost", () => window.__templateWebGL.lost++);
    }
    return value;
  };
});
const page = await context.newPage(); page.setDefaultTimeout(45000); expect.configure({ timeout: 25000 });
const checks = [], errors = [], consoleErrors = [], assetErrors = [], metrics = {};
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("response", response => { if (response.status() >= 400) assetErrors.push(`${response.status()} ${response.url()}`); });
const templates = [{ id: "empty", name: "Пустой проект", project: "Новая анимация", characters: 1 }, { id: "walk", name: "Анимация ходьбы", project: "Анимация ходьбы", characters: 1 }, { id: "combat", name: "Боевая сцена", project: "Боевая сцена", characters: 2 }, { id: "dance", name: "Танец", project: "Танец", characters: 1 }, { id: "cinematic", name: "Кинематографическая", project: "Кинематографическая сцена", characters: 1 }, { id: "gif", name: "Анимация для GIF", project: "Анимация для GIF", characters: 1 }];
const btn = (name, scope = page) => scope.getByRole("button", { name, exact: true });
const nav = name => page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name, exact: true });
const library = () => page.locator(".atl-library");
const card = id => page.locator(`.atl-card`).filter({ has: page.locator(`.atp-preview[data-template="${id}"]`) });
const preview = (id, scope = page) => scope.locator(`.atp-preview[data-template="${id}"]`);
const hash = async canvas => createHash("sha256").update(await canvas.evaluate(element => element.toDataURL("image/png"))).digest("hex");
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function noOverflow(label) { const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(sizes.scroll <= sizes.width + 1, `${label}: ${JSON.stringify(sizes)}`); }
async function lobby() { await expect(library()).toBeVisible(); await expect(page.locator(".as-studio")).toHaveCount(0); }
async function ready(id, scope = page) { const host = preview(id, scope); await host.scrollIntoViewIfNeeded(); await expect(host).toHaveAttribute("data-ready", "true"); await expect(host.locator("canvas")).toBeVisible(); return host.locator("canvas"); }
async function draft() { return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("minepose-animation-studio-v1", 1); request.onsuccess = () => { const db = request.result, read = db.transaction("meta").objectStore("meta").get("draft"); read.onsuccess = () => { resolve(read.result?.project); db.close(); }; read.onerror = () => reject(read.error); }; request.onerror = () => reject(request.error); })); }
async function saved() { await expect(page.locator(".as-save-state")).toHaveText("Сохранено"); return draft(); }
async function editor() { await expect(page.locator(".av-viewport")).toHaveAttribute("data-ready", "true"); }

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  const before = await page.evaluate(() => window.__templateWebGL.created);
  await nav("Анимации").click(); await lobby();
  await step("All six templates display real textured 3D canvases through a shared WebGL context", async () => {
    await expect(page.locator(".atl-card")).toHaveCount(6); await expect(library().locator("img")).toHaveCount(0);
    const hashes = [];
    for (const template of templates) {
      const canvas = await ready(template.id); hashes.push(await hash(canvas));
      const pixels = await canvas.evaluate(element => { const c = document.createElement("canvas"); c.width = 128; c.height = 80; const context = c.getContext("2d"); context.drawImage(element, 0, 0, 128, 80); const data = context.getImageData(0, 0, 128, 80).data, colors = new Set(); let visible = 0; for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) { visible++; colors.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`); } return { visible, colors: colors.size }; });
      assert.ok(pixels.visible > 150, `${template.id}: empty canvas`); assert.ok(pixels.colors > 30, `${template.id}: no textured model ${JSON.stringify(pixels)}`);
    }
    assert.equal(new Set(hashes).size, 6); metrics.contextsDuringTransition = (await page.evaluate(() => window.__templateWebGL.created)) - before;
    metrics.contextRecords = await page.evaluate(() => window.__templateWebGL.records);
    metrics.contextsForLibrary = metrics.contextRecords.filter(value => value.library).length;
    assert.equal(metrics.contextsForLibrary, 1, `Created ${metrics.contextsForLibrary} WebGL contexts for six previews: ${JSON.stringify(metrics.contextRecords)}`);
    await noOverflow("desktop library"); await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });
  });
  await step("Hover animates real rig frames and search/category filters remain functional", async () => {
    const canvas = await ready("walk"), initial = await hash(canvas); await card("walk").hover();
    await expect.poll(() => hash(canvas), { timeout: 15000 }).not.toBe(initial);
    const search = page.getByRole("textbox", { name: "Поиск шаблонов анимации", exact: true });
    await search.fill("Танец"); await expect(page.locator(".atl-card")).toHaveCount(1); await expect(btn("Создать анимацию: Танец")).toBeVisible();
    await search.fill("no-template-784"); await expect(page.locator(".atl-card")).toHaveCount(0); await search.fill("");
    await btn("Сцены").click(); const sceneCount = await page.locator(".atl-card").count(); assert.ok(sceneCount > 0 && sceneCount < 6);
    await btn("Все шаблоны").click(); await expect(page.locator(".atl-card")).toHaveCount(6);
  });
  await step("Quick preview provides actual playback, scrubbing and creates the selected animation", async () => {
    await btn("Предпросмотр шаблона: Анимация ходьбы").click();
    const modal = page.getByRole("dialog", { name: "Предпросмотр шаблона Анимация ходьбы", exact: true });
    const canvas = await ready("walk", modal); if (await btn("Приостановить шаблон", modal).isVisible()) await btn("Приостановить шаблон", modal).click();
    const slider = modal.getByRole("slider", { name: "Время предпросмотра шаблона", exact: true }); await slider.focus(); await slider.press("Home"); await settle(); const start = await hash(canvas);
    for (let i = 0; i < 12; i++) await slider.press("ArrowRight"); await expect.poll(() => hash(canvas)).not.toBe(start);
    const at = Number(await slider.inputValue()); assert.ok(at > 0); const paused = await hash(canvas); await btn("Воспроизвести шаблон", modal).click(); await expect.poll(() => hash(canvas)).not.toBe(paused);
    await btn("Создать анимацию из шаблона Анимация ходьбы", modal).click(); await editor(); const project = await saved(); assert.equal(project.name, "Анимация ходьбы"); assert.ok(project.tracks.length >= 6);
    await nav("Анимации").click(); await lobby();
  });
  let last;
  await step("Every template opens its genuine editable characters, tracks, camera and export settings", async () => {
    metrics.templates = [];
    for (const template of templates) {
      await btn(`Создать анимацию: ${template.name}`).click(); await editor(); const value = await saved();
      assert.equal(value.name, template.project); assert.equal(value.objects.filter(object => object.character).length, template.characters);
      assert.ok(value.objects.some(object => object.camera)); if (template.id === "empty") assert.equal(value.tracks.length, 0); else assert.ok(value.tracks.length >= 2);
      if (template.id === "combat") assert.ok(value.objects.some(object => object.item));
      if (template.id === "cinematic") { assert.equal(value.scene.environment, "forest"); assert.ok(value.tracks.some(track => value.objects.some(object => object.id === track.objectId && object.camera) && track.property === "position")); }
      if (template.id === "gif") { assert.equal(value.export.format, "gif"); assert.equal(value.export.transparent, true); assert.equal(value.export.width, value.export.height); }
      metrics.templates.push({ id: template.id, objects: value.objects.length, tracks: value.tracks.length }); last = value;
      await nav("Анимации").click(); await lobby(); assert.equal((await draft()).id, value.id);
    }
  });
  await step("Animations navigation and reload open the lobby while saved projects open only explicitly", async () => {
    await page.reload({ waitUntil: "networkidle" }); await nav("Анимации").click(); await lobby(); assert.equal((await draft()).id, last.id);
    await nav("Мои проекты").click(); await btn(`Открыть анимацию ${last.name}`).click(); await editor(); const restored = await saved(); assert.equal(restored.id, last.id); assert.deepEqual(restored.tracks, last.tracks);
    await nav("Анимации").click(); await lobby();
  });
  await step("Custom skin and Slim propagate to real previews and generated projects", async () => {
    const skin = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const c = canvas.getContext("2d"); c.fillStyle = "#ee309a"; c.fillRect(0, 0, 64, 64); c.clearRect(32, 0, 32, 16); c.clearRect(0, 32, 64, 16); c.clearRect(0, 48, 16, 16); c.clearRect(48, 48, 16, 16); return canvas.toDataURL("image/png"); });
    await page.evaluate(value => { localStorage.setItem("minepose-skin", value); localStorage.setItem("minepose-slim", "true"); }, skin);
    await page.reload({ waitUntil: "networkidle" }); await nav("Анимации").click(); await lobby();
    const canvas = await ready("walk"); await expect.poll(() => canvas.evaluate(element => { const c = document.createElement("canvas"); c.width = 160; c.height = 100; const context = c.getContext("2d"); context.drawImage(element, 0, 0, 160, 100); const pixels = context.getImageData(0, 0, 160, 100).data; let count = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 140 && pixels[i + 2] > 65 && pixels[i + 1] < pixels[i] * .6) count++; return count; })).toBeGreaterThan(30);
    await btn("Создать анимацию: Анимация ходьбы").click(); await editor(); const project = await saved(); assert.equal(project.objects.find(object => object.character).character.skin, skin); assert.equal(project.objects.find(object => object.character).character.slim, true);
    await nav("Анимации").click(); await lobby();
  });
  await step("Reduced motion pauses preview animation and the library fits narrow screens", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" }); const canvas = await ready("walk"); await card("walk").hover(); await settle(); const initial = await hash(canvas); await page.waitForTimeout(350); assert.equal(await hash(canvas), initial);
    for (const width of [1024, 768, 390, 320]) { await page.setViewportSize({ width, height: 1000 }); await settle(); await noOverflow(`library ${width}`); }
    await btn("Предпросмотр шаблона: Анимация для GIF").click();
    const modal = page.getByRole("dialog", { name: "Предпросмотр шаблона Анимация для GIF", exact: true });
    const modalCanvas = await ready("gif", modal), modalBounds = await modalCanvas.boundingBox();
    assert.ok(Math.abs(modalBounds.width / modalBounds.height - 1) < .01, `Square GIF preview: ${JSON.stringify(modalBounds)}`);
    await noOverflow("mobile preview dialog"); await page.screenshot({ path: path.join(artifacts, "mobile-preview.png"), fullPage: true });
    await btn("Закрыть предпросмотр шаблона", modal).click();
    await page.screenshot({ path: path.join(artifacts, "mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1660, height: 700 }); await nav("Инструменты").click();
    metrics.scrollbar = await page.locator(".sidebar").evaluate(element => { const style = getComputedStyle(element), bar = getComputedStyle(element, "::-webkit-scrollbar"); element.scrollTop = element.scrollHeight; return { width: style.scrollbarWidth, color: style.scrollbarColor, webkitWidth: bar.width, scrollTop: element.scrollTop, overflow: element.scrollHeight > element.clientHeight }; });
    assert.ok(metrics.scrollbar.width === "thin" || parseFloat(metrics.scrollbar.webkitWidth) <= 8); assert.notEqual(metrics.scrollbar.color, "auto"); if (metrics.scrollbar.overflow) assert.ok(metrics.scrollbar.scrollTop > 0);
    metrics.contexts = await page.evaluate(() => window.__templateWebGL); assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(assetErrors, []);
  });
} finally {
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ checks, metrics, errors, consoleErrors, assetErrors }, null, 2));
  await browser.close();
}
