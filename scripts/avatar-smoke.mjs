import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts", "avatar");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "ru-RU", acceptDownloads: true });
// Inspect real image ClipboardItems inside this profile without writing to the OS.
await context.addInitScript(() => {
  window.__avatarClipboardMode = "allow"; window.__avatarClipboardWrites = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async items => {
    if (window.__avatarClipboardMode === "deny") throw new DOMException("Clipboard denied", "NotAllowedError");
    for (const item of items) {
      const blob = await item.getType("image/png");
      window.__avatarClipboardWrites.push(Array.from(new Uint8Array(await blob.arrayBuffer())));
    }
  } } });
});
const page = await context.newPage(); page.setDefaultTimeout(30_000);
const errors = [], consoleErrors = [], checks = [], metricsReport = {};
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push({ text: message.text(), url: message.location().url }); });
const button = name => page.getByRole("button", { name, exact: true });
const text = name => page.getByRole("textbox", { name, exact: true });
const check = name => page.getByRole("checkbox", { name, exact: true });
const downloadButton = () => button("Скачать аватарку");
const transparent = () => check("Прозрачный фон при экспорте");
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready() { await expect(page.locator(".am-main-scene canvas")).toBeVisible(); await expect(page.locator(".am-rendering")).toHaveCount(0); await expect(downloadButton()).toBeEnabled(); await frames(); }
async function advanced() { const toggle = button("Поза и оформление"); if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click(); }
async function reset() { await button("Сбросить настройки аватарки").click(); await ready(); }
async function setRange(label, value) {
  const range = page.getByRole("slider", { name: label, exact: true }); const min = Number(await range.getAttribute("min"));
  await range.focus(); await range.press("Home");
  for (let i = min; i < value; i++) await range.press("ArrowRight");
  await expect(range).toHaveValue(String(value)); await frames();
}
async function size(value) { await page.getByRole("combobox", { name: "Размер аватарки", exact: true }).selectOption(String(value)); }
async function exportPng(filename, resolution) {
  await ready(); const pending = page.waitForEvent("download"); await downloadButton().click(); const result = await pending;
  assert.equal(await result.failure(), null); const file = path.join(artifacts, filename); await result.saveAs(file); const buffer = await readFile(file);
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(buffer.readUInt32BE(16), resolution); assert.equal(buffer.readUInt32BE(20), resolution);
  return { buffer, url: "data:image/png;base64," + buffer.toString("base64") };
}
async function pixels(url) {
  return page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode(); const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const c = canvas.getContext("2d"); c.drawImage(image, 0, 0); const data = c.getImageData(0, 0, image.width, image.height).data;
    const points = {}; for (const [label, x, y] of [["corner", 0, 0], ["topBorder", .5, .005], ["upperLeft", .08, .2], ["lowerLeft", .08, .8]]) { const i = (Math.floor(y * image.height) * image.width + Math.floor(x * image.width)) * 4; points[label] = [...data.slice(i, i + 4)]; }
    let opaque = 0, clear = 0, pink = 0, blue = 0; const bounds = { left: image.width, top: image.height, right: -1, bottom: -1 };
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 240) {
        opaque++; const x = i / 4 % image.width, y = Math.floor(i / 4 / image.width); bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x); bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
        if (data[i] > data[i + 1] * 1.4 && data[i + 2] > data[i + 1] * 1.2 && data[i] > 100) pink++;
        if (data[i + 2] > data[i] * 1.3 && data[i + 2] > data[i + 1] * 1.15 && data[i + 2] > 100) blue++;
      }
      if (!data[i + 3]) clear++;
    }
    return { width: image.width, height: image.height, opaque, clear, pink, blue, bounds, ...points };
  }, url);
}
async function noOverflow(label) {
  const width = await page.evaluate(() => ({ actual: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(width.actual <= width.viewport + 1, label + ": " + JSON.stringify(width));
}

try {
  assert.equal((await page.goto(baseURL, { waitUntil: "networkidle" }))?.status(), 200);
  const nav = page.getByRole("navigation", { name: "Главное меню" }); await nav.getByRole("button", { name: "Инструменты", exact: true }).click(); await nav.getByRole("button", { name: "Создатель аватарок", exact: true }).click();
  await ready(); await page.evaluate(() => document.fonts.ready);
  const fixtures = await page.evaluate(() => {
    function skin(color) { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); x.fillStyle = color; x.fillRect(0, 0, 64, 64); x.clearRect(32, 0, 32, 16); x.clearRect(0, 32, 64, 16); x.clearRect(0, 48, 16, 16); x.clearRect(48, 48, 16, 16); x.fillStyle = "#dca778"; x.fillRect(8, 8, 8, 8); x.fillStyle = "#191a24"; x.fillRect(9, 11, 2, 1); x.fillRect(13, 11, 2, 1); return c.toDataURL("image/png"); }
    const bad = document.createElement("canvas"); bad.width = bad.height = 1;
    return { pink: skin("#ed3c9a"), blue: skin("#3359ed"), invalid: bad.toDataURL("image/png") };
  });
  const pinkFile = path.join(artifacts, "pink-skin.png"), invalidFile = path.join(artifacts, "invalid-skin.png");
  await writeFile(pinkFile, Buffer.from(fixtures.pink.split(",")[1], "base64")); await writeFile(invalidFile, Buffer.from(fixtures.invalid.split(",")[1], "base64"));

  await step("Default portrait exports a framed 1024px photo and offers four real 3D presets", async () => {
    await expect(page.locator(".am-presets .am-preset")).toHaveCount(4); await expect(page.locator(".am-thumb-scene canvas")).toHaveCount(4);
    const output = await exportPng("portrait-default.png", 1024), result = await pixels(output.url);
    assert.deepEqual(result.corner, [255, 255, 255, 255], "white frame reaches corners"); assert.ok(result.opaque > 1_000_000);
    assert.notDeepEqual(result.upperLeft, result.lowerLeft, "real gradient background");
    const hashes = new Set();
    for (const name of ["Портрет", "Голова", "Мини", "Уверенная поза"]) {
      await button("Образ: " + name).click(); await ready(); await size(512); await transparent().check();
      const photo = await exportPng("preset-" + hashes.size + ".png", 512); hashes.add(createHash("sha256").update(photo.buffer).digest("hex"));
      const image = await pixels(photo.url); assert.equal(image.corner[3], 0); assert.ok(image.opaque > 5000 && image.clear > 50_000, name + " visible with alpha");
      if (name === "Голова") { assert.ok(image.bounds.bottom < 480 && image.bounds.top > 10, "head-only floats inside frame"); await advanced(); await expect(page.getByRole("combobox", { name: "Поза аватарки", exact: true })).toBeDisabled(); }
    }
    assert.equal(hashes.size, 4, "camera framing and real silhouettes differ");
  });

  await step("Skin validation, classic/Alex and 512/2048 transparent exports use the uploaded skin", async () => {
    await reset();
    const upload = page.getByLabel("Загрузить скин аватарки", { exact: true }); await upload.setInputFiles(invalidFile); await expect(page.locator(".am-error")).toContainText("64 × 64 или 64 × 32");
    await upload.setInputFiles(pinkFile); await ready(); await expect(button("Вернуть стандартного персонажа")).toBeVisible(); await transparent().check();
    await check("Тонкие руки (Alex)").check(); await ready();
    for (const resolution of [512, 2048]) {
      await size(resolution); const image = await exportPng(`pink-transparent-${resolution}.png`, resolution), data = await pixels(image.url);
      assert.equal(data.corner[3], 0); assert.ok(data.clear > resolution * resolution / 3); assert.ok(data.pink > resolution * 2, "uploaded skin visible at " + resolution);
    }
  });

  await step("Custom HEX colors, frame, round corners and zoom match the actual live photo in PNG", async () => {
    await reset(); await advanced(); await size(1024);
    await text("Верхний цвет").fill("#123456"); await text("Нижний цвет").fill("#F7A1D2"); await text("Цвет рамки").fill("#EEDDCC");
    await setRange("Ширина рамки", 40); await setRange("Масштаб персонажа", 110); await check("Скруглённые углы").check();
    await page.getByRole("combobox", { name: "Поза аватарки", exact: true }).selectOption("1"); await ready();
    const image = await exportPng("custom-photo.png", 1024), data = await pixels(image.url);
    assert.equal(data.corner[3], 0, "rounded corner alpha"); assert.deepEqual(data.topBorder, [238, 221, 204, 255], "custom frame color");
    assert.ok(data.upperLeft[0] < data.lowerLeft[0] && data.upperLeft[2] < data.lowerLeft[2], "custom gradient reaches exported pixels");
    const live = await page.locator(".am-photo").screenshot({ path: path.join(artifacts, "live-photo.png"), animations: "disabled" });
    const difference = await page.evaluate(async ({ actual, expected }) => {
      async function image(url) { const i = new Image(); i.src = url; await i.decode(); return i; }
      const [a, e] = await Promise.all([image(actual), image(expected)]); const c = document.createElement("canvas"); c.width = c.height = 1024; const x = c.getContext("2d");
      x.drawImage(a, 0, 0, 1024, 1024); const aa = x.getImageData(0, 0, 1024, 1024).data; x.clearRect(0, 0, 1024, 1024); x.drawImage(e, 0, 0); const ee = x.getImageData(0, 0, 1024, 1024).data;
      let total = 0, count = 0, near = 0; for (let i = 0; i < aa.length; i += 4) { if (ee[i + 3] !== 255) continue; const d = (Math.abs(aa[i] - ee[i]) + Math.abs(aa[i + 1] - ee[i + 1]) + Math.abs(aa[i + 2] - ee[i + 2])) / 3; total += d; count++; if (d < 12) near++; }
      return { meanAbsoluteError: total / count, closeFraction: near / count, pixels: count };
    }, { actual: "data:image/png;base64," + live.toString("base64"), expected: image.url });
    metricsReport.previewDifference = difference; assert.ok(difference.meanAbsoluteError < 8, "live preview/export mismatch: " + JSON.stringify(difference)); assert.ok(difference.closeFraction > .9);
    await button("Цвет").click(); await text("Цвет фона").fill("#12ABEF"); await check("Рамка фотографии").uncheck(); await check("Скруглённые углы").uncheck();
    const solid = await exportPng("custom-solid.png", 1024); assert.deepEqual((await pixels(solid.url)).corner, [18, 171, 239, 255]);
  });

  await step("Nickname loading reports errors, applies the fetched model and ignores stale requests after PNG upload", async () => {
    await reset(); let releaseSlow; let slowSeen = false; let delayedFulfill;
    const delayed = new Promise(resolve => { releaseSlow = resolve; });
    await page.route("**/api/skin?name=*", async route => {
      const name = new URL(route.request().url()).searchParams.get("name");
      if (name === "MissingSkin") { await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Игрок не найден в Minecraft Java Edition." }) }); return; }
      if (name === "SlowSkin") { slowSeen = true; await delayed; delayedFulfill = route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ skin: fixtures.blue, name: "SlowSkin", slim: true }) }).catch(() => {}); await delayedFulfill; return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ skin: fixtures.blue, name: "BlueSkin", slim: true }) });
    });
    await text("Никнейм Minecraft Java").fill("аб"); await button("Найти скин").click(); await expect(page.locator(".am-error")).toContainText("от 3 до 16");
    await text("Никнейм Minecraft Java").fill("MissingSkin"); await button("Найти скин").click(); await expect(page.locator(".am-error")).toContainText("Игрок не найден"); await expect(downloadButton()).toBeEnabled();
    await text("Никнейм Minecraft Java").fill("BlueSkin"); await button("Найти скин").click(); await ready(); await expect(page.locator(".am-character-info")).toContainText("BlueSkin"); await expect(check("Тонкие руки (Alex)")).toBeChecked();
    await size(512); await transparent().check(); const blue = await pixels((await exportPng("nickname-blue.png", 512)).url); assert.ok(blue.blue > 2000, "fetched skin reaches PNG");
    await text("Никнейм Minecraft Java").fill("SlowSkin"); await button("Найти скин").click(); await expect.poll(() => slowSeen).toBe(true); await expect(downloadButton()).toBeDisabled();
    await page.getByLabel("Загрузить скин аватарки", { exact: true }).setInputFiles(pinkFile); await ready(); releaseSlow(); await frames(); if (delayedFulfill) await delayedFulfill;
    await expect(page.locator(".am-character-info")).toContainText("pink-skin"); const pink = await pixels((await exportPng("race-pink.png", 512)).url); assert.ok(pink.pink > 2000 && pink.pink > pink.blue * 4, "stale nickname cannot replace uploaded skin");
    await page.unroute("**/api/skin?name=*");
  });

  await step("Copy exports a real PNG and handles clipboard denial", async () => {
    await button("Скопировать аватарку").click(); await expect.poll(() => page.evaluate(() => window.__avatarClipboardWrites.length)).toBe(1);
    const bytes = Buffer.from(await page.evaluate(() => window.__avatarClipboardWrites[0])); assert.equal(bytes.readUInt32BE(16), 512); assert.equal(bytes.readUInt32BE(20), 512);
    await page.evaluate(() => { window.__avatarClipboardMode = "deny"; }); await button("Скопировать аватарку").click();
    await expect(page.locator(".toast")).toContainText("Браузер не разрешил доступ к буферу обмена");
    await page.evaluate(() => { window.__avatarClipboardMode = "allow"; });
  });

  await step("The photo and all controls fit 390px and 320px screens", async () => {
    await reset(); await page.screenshot({ path: path.join(artifacts, "avatar-desktop.png"), fullPage: true });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await page.keyboard.press("Escape"); if (await button("Закрыть уведомление").count()) await button("Закрыть уведомление").click(); await ready(); await noOverflow("avatar at " + width);
      await button("Образ: Мини").click(); await ready(); await advanced(); await setRange("Масштаб персонажа", 105); await noOverflow("avatar settings at " + width);
      await page.screenshot({ path: path.join(artifacts, `avatar-mobile-${width}.png`), fullPage: true });
    }
  });
  await step("No browser runtime errors", async () => assert.deepEqual(errors, []));
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: true, checks, errors, consoleErrors, metrics: metricsReport }, null, 2));
  console.log(`\nAll ${checks.length} avatar checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: false, checks, errors, consoleErrors, metrics: metricsReport, error: error.stack || String(error) }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
