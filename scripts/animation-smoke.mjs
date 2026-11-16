import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { unzipSync } from "fflate";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts/animation-studio");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1660, height: 1080 }, deviceScaleFactor: 1, locale: "ru-RU", acceptDownloads: true });
const page = await context.newPage(); page.setDefaultTimeout(45000);
expect.configure({ timeout: 20000 });
const checks = [], errors = [], assetErrors = [];
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("response", response => { if (response.status() >= 400) assetErrors.push(`${response.status()} ${response.url()}`); });
const btn = (name, scope = page) => scope.getByRole("button", { name, exact: true });
const field = name => page.getByRole("spinbutton", { name, exact: true });
const nav = name => page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name, exact: true });
const ready = async () => { await expect(page.locator(".av-viewport canvas")).toBeVisible(); await expect(page.locator(".av-status")).toHaveCount(0); await expect(btn("Экспорт")).toBeEnabled(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
const seek = async time => { await field("Текущее время анимации").fill(String(time)); await field("Текущее время анимации").blur(); };
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function stored() { return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open("minepose-animation-studio-v1", 1); request.onsuccess = () => { const db = request.result, read = db.transaction("meta", "readonly").objectStore("meta").get("draft"); read.onsuccess = () => { resolve(read.result?.project || null); db.close(); }; read.onerror = () => reject(read.error); }; request.onerror = () => reject(request.error); })); }
async function saved() { await expect(page.locator(".as-save-state")).toHaveText("Сохранено"); return stored(); }
async function canvasHash() { return createHash("sha256").update(await page.locator(".av-viewport canvas").evaluate(canvas => canvas.toDataURL("image/png"))).digest("hex"); }
async function exportFile(format, name) {
  await btn("Экспорт").click();
  const dialog = page.getByRole("dialog", { name: "Экспорт анимации" });
  const formatButton = dialog.locator(".as-format-grid button").filter({ has: page.locator("strong", { hasText: new RegExp(`^${format.replace(".", "\\.")}$`) }) });
  await expect(formatButton).toBeEnabled(); await formatButton.click();
  if (format !== ".minepose") {
    await field("Ширина экспорта анимации").fill("320"); await field("Высота экспорта анимации").fill("320");
    await field("Начало экспорта").fill("0"); await field("Конец экспорта").fill("0.5");
    await page.getByRole("combobox", { name: "FPS экспорта", exact: true }).selectOption("24");
  }
  const pending = page.waitForEvent("download", { timeout: 120000 });
  await btn("Экспортировать анимацию", dialog).click();
  const download = await pending; assert.equal(await download.failure(), null);
  const file = path.join(artifacts, name); await download.saveAs(file);
  await expect(dialog.locator(".as-export-result")).toBeVisible();
  await btn("Закрыть экспорт анимации").click();
  return { file, buffer: await readFile(file) };
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await step("Animation tab opens six templates and creates a real scene", async () => {
    await nav("Анимации").click(); await expect(page.locator(".atl-card")).toHaveCount(6);
    await btn("Создать анимацию: Пустой проект").click(); await ready();
    await page.getByRole("textbox", { name: "Название анимации", exact: true }).fill("Проверка Animation Studio");
    await page.getByRole("textbox", { name: "Название анимации", exact: true }).blur();
    await expect(page.locator(".as-tree-part")).toHaveCount(6);
    const p = await saved(); assert.equal(p.kind, "animation"); assert.equal(p.objects.filter(o => o.character).length, 1);
    assert.equal(p.objects.find(o => o.camera).camera.zoom, 1);
  });
  await step("Custom Minecraft skin is rendered and Classic/Slim remains editable", async () => {
    const skin = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64; const c = canvas.getContext("2d"); c.fillStyle = "#ee309a"; c.fillRect(0, 0, 64, 64); c.clearRect(32, 0, 32, 16); c.clearRect(0, 32, 64, 16); c.clearRect(0, 48, 16, 16); c.clearRect(48, 48, 16, 16); return canvas.toDataURL("image/png"); });
    await page.getByLabel("Скин персонажа анимации", { exact: true }).setInputFiles({ name: "studio-skin.png", mimeType: "image/png", buffer: Buffer.from(skin.split(",")[1], "base64") });
    await expect(page.locator(".as-skin-upload")).toContainText("Заменить скин");
    await page.getByRole("combobox", { name: "Модель персонажа анимации", exact: true }).selectOption("alex");
    const p = await saved(); assert.equal(p.objects.find(o => o.character).character.skin, skin); assert.equal(p.objects.find(o => o.character).character.slim, true);
    await expect.poll(() => page.locator(".av-viewport canvas").evaluate(canvas => { const image = document.createElement("canvas"); image.width = canvas.width; image.height = canvas.height; const c = image.getContext("2d"); c.drawImage(canvas, 0, 0); const data = c.getImageData(0, 0, image.width, image.height).data; let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 140 && data[i + 2] > 65 && data[i + 1] < data[i] * .6) count++; return count; })).toBeGreaterThan(100);
  });
  await step("Arm keys at 1s and 2s interpolate smoothly and Undo/Redo preserves tracks", async () => {
    await page.locator(".as-tree-part").filter({ hasText: "Правая рука" }).first().click();
    await seek(1); await field("Вращение части тела X").fill("-90"); await field("Вращение части тела X").blur();
    await seek(2); await field("Вращение части тела X").fill("30"); await field("Вращение части тела X").blur();
    let p = await saved(); const track = p.tracks.find(t => t.property === "pose.rightArm"); assert.deepEqual(track.keyframes.map(k => k.time), [0, 1, 2]);
    await seek(1.5); assert.ok(Math.abs(Number(await field("Вращение части тела X").inputValue()) + 30) < .1);
    await seek(2); await btn("Отменить действие анимации").click(); p = await saved(); assert.equal(p.tracks.find(t => t.property === "pose.rightArm").keyframes.length, 2);
    await btn("Повторить действие анимации").click(); p = await saved(); assert.equal(p.tracks.find(t => t.property === "pose.rightArm").keyframes.length, 3);
    await seek(0); const before = await canvasHash(); await btn("Воспроизвести анимацию").click();
    await expect.poll(async () => Number(await field("Текущее время анимации").inputValue())).toBeGreaterThan(.25);
    await btn("Остановить воспроизведение").click(); assert.notEqual(await canvasHash(), before);
  });
  await step("Second character has independent animation and camera keys remain separate", async () => {
    await seek(0); await btn("Добавить персонажа").click(); await ready();
    await page.getByRole("combobox", { name: "Готовая анимация", exact: true }).selectOption("dance");
    await page.locator(".as-preset-length").getByRole("button", { name: "Добавить", exact: true }).click();
    let p = await saved(); const chars = p.objects.filter(o => o.character); assert.equal(chars.length, 2);
    assert.ok(p.tracks.filter(t => t.objectId === chars[1].id).length >= 6); assert.equal(p.tracks.filter(t => t.objectId === chars[0].id).length, 1);
    await page.locator(".as-tree-name").filter({ hasText: /^Камера$/ }).click(); await seek(1);
    await field("Позиция X").fill("3"); await field("Позиция X").blur();
    p = await saved(); assert.ok(p.tracks.some(t => t.objectId === p.objects.find(o => o.camera).id && t.property === "position"));
    await page.getByRole("combobox", { name: "Ракурс анимационной сцены", exact: true }).selectOption("camera"); await ready();
    await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });
  });
  let preserved;
  await step("Saved project survives reload and opens through My Projects with every key", async () => {
    await btn("Сохранить").click(); preserved = await saved();
    await page.reload({ waitUntil: "networkidle" }); await nav("Мои проекты").click();
    await btn(`Открыть анимацию ${preserved.name}`).click(); await ready();
    const p = await saved(); assert.deepEqual(p.tracks, preserved.tracks); assert.deepEqual(p.objects, preserved.objects);
  });
  await step("Real .minepose and PNG exports preserve data and requested dimensions", async () => {
    const editable = await exportFile(".minepose", "project.minepose"); const json = JSON.parse(editable.buffer.toString());
    assert.equal(json.kind, "animation"); assert.equal(json.tracks.length, preserved.tracks.length);
    const png = await exportFile("PNG", "frame.png"); assert.equal(png.buffer.subarray(1, 4).toString(), "PNG"); assert.equal(png.buffer.readUInt32BE(16), 320); assert.equal(png.buffer.readUInt32BE(20), 320);
  });
  await step("Next worker exports an actual multi-frame GIF and PNG sequence ZIP", async () => {
    const gif = await exportFile("GIF", "animation.gif"); assert.match(gif.buffer.subarray(0, 6).toString(), /^GIF8[79]a$/);
    const decoded = await page.evaluate(async bytes => { const decoder = new ImageDecoder({ data: new Uint8Array(bytes), type: "image/gif" }); await decoder.tracks.ready; const count = decoder.tracks.selectedTrack.frameCount; const first = await decoder.decode({ frameIndex: 0 }); const last = await decoder.decode({ frameIndex: count - 1 }); const hash = image => { const c = document.createElement("canvas"); c.width = image.displayWidth; c.height = image.displayHeight; c.getContext("2d").drawImage(image, 0, 0); return c.toDataURL(); }; const distinct = hash(first.image) !== hash(last.image); first.image.close(); last.image.close(); decoder.close(); return { count, distinct }; }, [...gif.buffer]);
    assert.ok(decoded.count >= 10); assert.equal(decoded.distinct, true);
    const zip = await exportFile("PNG-кадры", "frames.zip"); const entries = unzipSync(zip.buffer); assert.equal(Object.keys(entries).filter(name => name.endsWith(".png")).length, 12);
  });
  await step("Native WebM and MP4 exports decode as video with real duration", async () => {
    for (const format of ["WebM", "MP4"]) {
      const { buffer } = await exportFile(format, `animation.${format.toLowerCase()}`);
      const metadata = await page.evaluate(async ({ bytes, mime }) => { const video = document.createElement("video"), url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime })); video.src = url; await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error("Video failed to decode")); }); const data = { duration: video.duration, width: video.videoWidth, height: video.videoHeight }; URL.revokeObjectURL(url); return data; }, { bytes: [...buffer], mime: format === "MP4" ? "video/mp4" : "video/webm" });
      assert.equal(metadata.width, 320); assert.equal(metadata.height, 320); assert.ok(metadata.duration >= .45 && metadata.duration <= .6);
    }
  });
  await step("The current animation frame opens as a pose and returns to a new animation", async () => {
    await seek(1.5); await page.locator(".as-tree-name").filter({ hasText: /^Персонаж$/ }).click();
    await btn("Открыть кадр как позу").click(); await expect(page.locator(".pe-scene canvas")).toBeVisible();
    const pending = page.waitForEvent("download"); await btn("Скачать файл проекта").click(); const download = await pending;
    const file = path.join(artifacts, "animation-frame-pose.json"); await download.saveAs(file); const pose = JSON.parse(await readFile(file, "utf8"));
    assert.equal(pose.kind, "pose"); assert.ok(Math.abs(pose.pose.rightArm.x + 30) < .1); assert.ok(pose.scene.skin.startsWith("data:image/png")); assert.equal(pose.scene.slim, true);
    await btn("Создать анимацию").click(); await ready(); const project = await saved();
    assert.equal(project.kind, "animation"); assert.deepEqual(project.objects.find(o => o.character).character.pose, pose.pose);
    assert.equal(project.objects.find(o => o.character).character.skin, pose.scene.skin);
  });
  await step("Advanced controls and narrow screens retain usable panels without page overflow", async () => {
    await btn("Продвинутый").click(); await btn("Возможности Animation Studio").click();
    await expect(page.getByRole("dialog", { name: "Возможности студии" })).toContainText("недоступны"); await btn("Закрыть справку анимации").click();
    for (const width of [1024, 768, 390, 320]) { await page.setViewportSize({ width, height: 900 }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve))); const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth })); assert.ok(size.scroll <= size.width + 1, JSON.stringify(size)); }
    await page.screenshot({ path: path.join(artifacts, "mobile.png"), fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(assetErrors, []);
  });
} finally {
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ checks, errors, assetErrors }, null, 2));
  await browser.close();
}
