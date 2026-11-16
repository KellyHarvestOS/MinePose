import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts/animation-camera");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1660, height: 1080 }, acceptDownloads: true });
page.setDefaultTimeout(30000); expect.configure({ timeout: 20000 });
const errors = [], checks = [], metrics = {};
page.on("pageerror", error => errors.push(error.message));
const btn = name => page.getByRole("button", { name, exact: true });
const num = name => page.getByRole("spinbutton", { name, exact: true });
const canvas = () => page.locator(".av-viewport canvas");
const frame = () => page.locator(".av-viewport");
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function settle() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function seek(value) { await num("Текущее время анимации").fill(String(value)); await num("Текущее время анимации").blur(); await settle(); }
async function readDraft() { return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("minepose-animation-studio-v1", 1); request.onsuccess = () => { const db = request.result, read = db.transaction("meta").objectStore("meta").get("draft"); read.onsuccess = () => { resolve(read.result.project); db.close(); }; read.onerror = () => reject(read.error); }; request.onerror = () => reject(request.error); })); }
async function importProject(value) { await page.getByLabel("Открыть файл анимации", { exact: true }).setInputFiles({ name: "camera.minepose", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) }); await expect(frame()).toHaveAttribute("data-ready", "true"); await settle(); }
async function imageDifference(left, right) { return page.evaluate(async ({ left, right }) => { const load = source => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source; }); const images = await Promise.all([load(left), load(right)]); const pixels = images.map(image => { const target = document.createElement("canvas"); target.width = 128; target.height = 72; const context = target.getContext("2d"); context.drawImage(image, 0, 0, 128, 72); return context.getImageData(0, 0, 128, 72).data; }); let sum = 0; for (let i = 0; i < pixels[0].length; i++) sum += Math.abs(pixels[0][i] - pixels[1][i]); return sum / pixels[0].length; }, { left, right }); }
async function aspect(expected) { const bounds = await canvas().boundingBox(); assert.ok(Math.abs(bounds.width / bounds.height - expected) < .002, JSON.stringify(bounds)); }

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: "Анимации", exact: true }).click();
  await btn("Создать анимацию: Анимация ходьбы").click(); await expect(frame()).toHaveAttribute("data-ready", "true");
  await btn("Сохранить").click(); await expect(page.locator(".as-save-state")).toHaveText("Сохранено");
  const project = await readDraft(), first = project.objects.find(object => object.camera), second = structuredClone(first);
  second.id = "export-camera-test"; second.name = "Камера экспорта"; second.transform.position = { x: -3.5, y: 2.5, z: 5.5 }; project.objects.push(second);
  project.tracks.push({ id: "camera-position-test", objectId: second.id, property: "position", layerId: "base", muted: false, locked: false, keyframes: [{ id: "camera-start-test", time: 0, value: structuredClone(second.transform.position), easing: "linear" }, { id: "camera-end-test", time: 1, value: { x: -1.5, y: 3.5, z: 6 }, easing: "linear" }] });
  project.export = { ...project.export, format: "png", width: 640, height: 360, start: 0, transparent: false, cameraId: second.id };
  project.scene.transparent = true;
  await importProject(project);
  await step("Dedicated camera preview uses the export camera and exact 16:9 frame", async () => {
    await btn("Вид из камеры").click(); await expect(btn("Вид из камеры")).toHaveAttribute("aria-pressed", "true");
    await expect(frame()).toHaveAttribute("data-export-camera", second.id); await expect(page.locator(".as-camera-frame-info")).toContainText("Камера экспорта · 640 × 360");
    await expect.poll(async () => { const box = await canvas().boundingBox(); return Math.round(box.width / box.height * 100); }).toBe(178);
    await aspect(16 / 9); await settle(); await page.screenshot({ path: path.join(artifacts, "landscape.png") });
  });
  await step("Preview matches the actual PNG export without grid, helpers or transparency mismatch", async () => {
    await seek(0); const preview = await canvas().evaluate(canvas => canvas.toDataURL("image/png"));
    const cornerAlpha = await canvas().evaluate(canvas => { const target = document.createElement("canvas"); target.width = canvas.width; target.height = canvas.height; const context = target.getContext("2d"); context.drawImage(canvas, 0, 0); return context.getImageData(0, 0, 1, 1).data[3]; });
    assert.equal(cornerAlpha, 255);
    await btn("Экспорт").click(); const dialog = page.getByRole("dialog", { name: "Экспорт анимации" });
    const pending = page.waitForEvent("download"); await dialog.getByRole("button", { name: "Экспортировать анимацию", exact: true }).click(); const download = await pending;
    const file = path.join(artifacts, "export.png"); await download.saveAs(file); const png = await readFile(file);
    metrics.previewExportDifference = await imageDifference(preview, "data:image/png;base64," + png.toString("base64")); assert.ok(metrics.previewExportDifference < 3, String(metrics.previewExportDifference));
    await btn("Закрыть экспорт анимации").click();
  });
  await step("Camera preview remains live during animation playback", async () => {
    await seek(0); const before = await canvas().evaluate(canvas => canvas.toDataURL());
    await seek(1); const animatedCamera = await canvas().evaluate(canvas => canvas.toDataURL()); assert.ok(await imageDifference(before, animatedCamera) > 1); await seek(0);
    await btn("Воспроизвести анимацию").click(); await expect.poll(async () => Number(await num("Текущее время анимации").inputValue())).toBeGreaterThan(.25); await btn("Остановить воспроизведение").click();
    assert.notEqual(await canvas().evaluate(canvas => canvas.toDataURL()), before); await expect(frame()).toHaveClass(/is-final-preview/);
  });
  await step("Leaving camera preview restores the editor camera and Escape exits it", async () => {
    await btn("Выйти из вида камеры").click(); await seek(0); const editor = await canvas().evaluate(canvas => canvas.toDataURL());
    await btn("Вид из камеры").click(); await settle(); await page.locator(".as-project-name>span").click(); await page.keyboard.press("Escape"); await expect(btn("Вид из камеры")).toHaveAttribute("aria-pressed", "false"); await settle();
    assert.equal(await canvas().evaluate(canvas => canvas.toDataURL()), editor);
  });
  await step("Portrait and transparent camera frames use actual export settings", async () => {
    const portrait = structuredClone(project); portrait.export.width = 360; portrait.export.height = 640; portrait.export.transparent = true;
    await importProject(portrait); await btn("Вид из камеры").click(); await settle();
    await expect.poll(async () => { const box = await canvas().boundingBox(); return Math.round(box.width / box.height * 100); }).toBe(56); await aspect(9 / 16);
    const alpha = await canvas().evaluate(canvas => { const target = document.createElement("canvas"); target.width = canvas.width; target.height = canvas.height; const context = target.getContext("2d"); context.drawImage(canvas, 0, 0); return context.getImageData(0, 0, 1, 1).data[3]; }); assert.equal(alpha, 0);
    await page.screenshot({ path: path.join(artifacts, "portrait.png") });
  });
  await step("Camera preview fits mobile screens without overflow", async () => {
    for (const width of [768, 390, 320]) { await page.setViewportSize({ width, height: 900 }); await settle(); await expect(btn("Вид из камеры")).toBeVisible(); await aspect(9 / 16); const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width, JSON.stringify(size)); }
    await page.screenshot({ path: path.join(artifacts, "mobile.png") }); assert.deepEqual(errors, []);
  });
} finally {
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ checks, metrics, errors }, null, 2)); await browser.close();
}
