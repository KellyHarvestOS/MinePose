import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts", "tools");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, locale: "ru-RU", acceptDownloads: true, reducedMotion: "reduce" });
// Mock only this isolated page's clipboard writer; never touch the OS clipboard.
await context.addInitScript(() => {
  window.__clipboardMode = "allow";
  window.__clipboardWrites = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: async items => {
    if (window.__clipboardMode === "deny") throw new DOMException("Test clipboard denial", "NotAllowedError");
    for (const item of items) {
      if (!(item instanceof ClipboardItem)) throw new Error("Expected a real ClipboardItem");
      const blob = await item.getType("image/png");
      const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
      });
      window.__clipboardWrites.push({ types: item.types, type: blob.type, size: blob.size, bytes, dataUrl });
    }
  } } });
});
const page = await context.newPage(); page.setDefaultTimeout(20_000);
const runtimeErrors = [], consoleErrors = [], checks = [];
page.on("pageerror", error => runtimeErrors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
async function step(name, action) { await action(); checks.push(name); console.log("PASS " + name); }
async function openTool(name) {
  const drawer = page.getByRole("button", { name: "Открыть меню", exact: true });
  if (await drawer.isVisible() && !(await page.locator(".sidebar").getAttribute("class")).includes("is-open")) await drawer.click();
  const nav = page.getByRole("navigation", { name: "Главное меню" });
  const tools = nav.getByRole("button", { name: "Инструменты", exact: true });
  if (await tools.getAttribute("aria-expanded") !== "true") await tools.click();
  await nav.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
async function noOverflow(label) {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.scroll <= size.viewport + 1, label + ": horizontal overflow");
}
async function imageMetrics(dataUrl) {
  return page.evaluate(async url => {
    const image = new window.Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext("2d"); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0, clear = 0, pink = 0, customColor = 0;
    const colors = new Set(), bounds = { left: image.width, top: image.height, right: -1, bottom: -1 };
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 240) {
        opaque++;
        const x = i / 4 % image.width, y = Math.floor(i / 4 / image.width);
        bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x); bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
        if (pixels[i] > 100 && pixels[i + 2] > 80 && pixels[i] > pixels[i + 1] * 1.3 && pixels[i + 2] > pixels[i + 1] * 1.1) pink++;
        if (pixels[i] === 18 && pixels[i + 1] === 171 && pixels[i + 2] === 239) customColor++;
        colors.add([pixels[i], pixels[i + 1], pixels[i + 2]].join(","));
      }
      if (!pixels[i + 3]) clear++;
    }
    return { width: image.width, height: image.height, corner: Array.from(pixels.subarray(0, 4)), opaque, clear, pink, customColor, colors: colors.size, bounds };
  }, dataUrl);
}
async function exportPng(button, filename, width, height, transparent) {
  const pending = page.waitForEvent("download"); await button.click(); const download = await pending;
  assert.equal(await download.failure(), null);
  const file = path.join(artifacts, filename); await download.saveAs(file); const buffer = await readFile(file);
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(buffer.readUInt32BE(16), width); assert.equal(buffer.readUInt32BE(20), height);
  const metrics = await imageMetrics("data:image/png;base64," + buffer.toString("base64"));
  assert.ok(metrics.opaque > 500, filename + ": visible exported content");
  assert.equal(metrics.corner[3], transparent ? 0 : 255, filename + ": corner alpha");
  if (transparent) assert.ok(metrics.clear > width * height / 3, filename + ": transparent background");
  return { file, buffer, metrics };
}
const headingCanvas = () => page.locator(".hg-preview-canvas");
const headingData = () => headingCanvas().evaluate(canvas => canvas.toDataURL("image/png"));
const headingHash = async () => createHash("sha256").update(await headingData()).digest("hex");
async function waitHeading() {
  await expect(headingCanvas()).toBeVisible();
  await expect(page.locator(".hg-preview-loading")).toHaveCount(0);
  await expect(page.locator(".hg-preview-error")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}
async function setRange(name, value) {
  const range = page.getByRole("slider", { name, exact: true }), minimum = Number(await range.getAttribute("min")), maximum = Number(await range.getAttribute("max"));
  await range.focus();
  if (value === maximum) await range.press("End");
  else { await range.press("Home"); for (let step = minimum; step < value; step++) await range.press("ArrowRight"); }
  await expect(range).toHaveValue(String(value));
}
function assertUnclipped(metrics, label) {
  assert.ok(metrics.opaque > 500, label + ": rendered glyphs");
  assert.ok(metrics.bounds.left > 0 && metrics.bounds.top > 0 && metrics.bounds.right < metrics.width - 1 && metrics.bounds.bottom < metrics.height - 1, label + ": content stays inside image bounds");
}
try {
  const response = await page.goto(baseURL, { waitUntil: "networkidle" }); assert.equal(response?.status(), 200);
  const fixtures = await page.evaluate(() => {
    const skin = document.createElement("canvas"); skin.width = 64; skin.height = 64;
    const c = skin.getContext("2d"); c.fillStyle = "#ed3c9a"; c.fillRect(0, 0, 64, 64);
    c.clearRect(32, 0, 32, 16); c.clearRect(0, 32, 64, 16); c.clearRect(0, 48, 16, 16); c.clearRect(48, 48, 16, 16);
    c.fillStyle = "#dcb080"; c.fillRect(8, 8, 8, 8); c.fillStyle = "#3d2d29"; c.fillRect(8, 8, 8, 2);
    c.fillStyle = "#151d29"; c.fillRect(9, 11, 2, 1); c.fillRect(13, 11, 2, 1);
    const invalid = document.createElement("canvas"); invalid.width = 1; invalid.height = 1;
    return { skin: skin.toDataURL("image/png"), invalid: invalid.toDataURL("image/png") };
  });
  async function fixture(name, url) { const file = path.join(artifacts, name); await writeFile(file, Buffer.from(url.split(",")[1], "base64")); return file; }
  const skinFile = await fixture("test-skin-64.png", fixtures.skin), invalidFile = await fixture("invalid-skin-1.png", fixtures.invalid);

  await step("Heading font picker renders eight distinct fonts with Cyrillic glyphs", async () => {
    await openTool("Генератор заголовков");
    await page.getByRole("textbox", { name: "Текст заголовка", exact: true }).fill("МАЙН 100\nMINEPOSE");
    await page.getByRole("checkbox", { name: "Прозрачный фон", exact: true }).check();
    await waitHeading();
    const names = ["Minecraft", "Pixelify", "Ретро 8-bit", "Tiny5", "Блочный", "Техно", "Массивный", "Чистый"], hashes = new Set();
    await expect(page.getByRole("group", { name: "Шрифт заголовка", exact: true }).getByRole("button")).toHaveCount(8);
    for (const name of names) {
      const previous = await headingHash(), button = page.getByRole("button", { name: "Шрифт " + name, exact: true });
      const alreadySelected = await button.getAttribute("aria-pressed") === "true";
      await button.click(); await expect(button).toHaveAttribute("aria-pressed", "true"); await waitHeading();
      if (!alreadySelected) await expect.poll(headingHash).not.toBe(previous);
      const dataUrl = await headingData(); hashes.add(createHash("sha256").update(dataUrl).digest("hex"));
      assertUnclipped(await imageMetrics(dataUrl), "font " + name);
    }
    assert.equal(hashes.size, 8, "all font choices change actual glyph pixels");
    await noOverflow("heading font picker");
  });
  await step("Heading accepts arbitrary HEX colors, gradient and editable outline/depth/spacing", async () => {
    await page.getByRole("button", { name: "Шрифт Minecraft", exact: true }).click(); await waitHeading();
    await page.getByRole("textbox", { name: "Свой цвет текста", exact: true }).fill("#12ABEF"); await waitHeading();
    await expect(page.getByRole("textbox", { name: "Свой цвет текста", exact: true })).toHaveValue("#12ABEF");
    const solid = await imageMetrics(await headingData()); assert.ok(solid.customColor > 500, "custom HEX reaches glyph pixels");
    await page.getByRole("checkbox", { name: "Градиент текста", exact: true }).check();
    await page.getByRole("textbox", { name: "Второй цвет", exact: true }).fill("#F73193"); await waitHeading();
    const gradient = await imageMetrics(await headingData()); assert.ok(gradient.colors > solid.colors + 5, "gradient has multiple real color steps");
    await page.getByRole("button", { name: /^Настроить детали/ }).click();
    await setRange("Объём", 12); await setRange("Толщина обводки", 6); await setRange("Размер надписи", 150); await setRange("Расстояние между буквами", 6);
    await page.getByRole("textbox", { name: "Цвет обводки", exact: true }).fill("#000000"); await waitHeading();
    assertUnclipped(await imageMetrics(await headingData()), "maximum heading effects");
  });
  await step("A 90-character Cyrillic heading fits two lines and exports transparent and solid 1600 x 480 PNG", async () => {
    const longText = "А".repeat(44) + "\n" + "Ж".repeat(45); assert.equal(longText.length, 90);
    await page.getByRole("textbox", { name: "Текст заголовка", exact: true }).fill(longText); await waitHeading();
    await expect(page.getByRole("textbox", { name: "Текст заголовка", exact: true })).toHaveValue(longText);
    const transparent = await exportPng(page.getByRole("button", { name: "Скачать заголовок", exact: true }), "heading-transparent.png", 1600, 480, true);
    assertUnclipped(transparent.metrics, "90-character PNG");
    await page.getByRole("checkbox", { name: "Прозрачный фон", exact: true }).uncheck();
    await page.getByRole("textbox", { name: "Цвет фона", exact: true }).fill("#213345"); await waitHeading();
    const solid = await exportPng(page.getByRole("button", { name: "Скачать заголовок", exact: true }), "heading-solid.png", 1600, 480, false);
    assert.deepEqual(solid.metrics.corner, [33, 51, 69, 255], "custom exported background");
    await page.getByRole("checkbox", { name: "Прозрачный фон", exact: true }).check(); await waitHeading();
  });
  await step("Copy PNG provides a real ClipboardItem and handles denial without touching the OS clipboard", async () => {
    await page.getByRole("textbox", { name: "Текст заголовка", exact: true }).fill("БУФЕР\nMINEPOSE"); await waitHeading();
    const expectedImage = await headingData();
    await page.getByRole("button", { name: "Скопировать PNG", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__clipboardWrites.length)).toBe(1);
    await expect(page.locator(".toast")).toContainText("Заголовок скопирован");
    const clipboard = await page.evaluate(() => window.__clipboardWrites[0]), buffer = Buffer.from(clipboard.bytes);
    assert.ok(clipboard.types.includes("image/png")); assert.equal(clipboard.type, "image/png"); assert.ok(clipboard.size > 500);
    assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(buffer.readUInt32BE(16), 1600); assert.equal(buffer.readUInt32BE(20), 480);
    assert.equal(clipboard.dataUrl, expectedImage, "clipboard image matches preview");
    await page.evaluate(() => { window.__clipboardMode = "deny"; });
    await page.getByRole("button", { name: "Скопировать PNG", exact: true }).click();
    await expect(page.locator(".toast")).toContainText("Браузер не разрешил доступ к буферу обмена");
    assert.equal(await page.evaluate(() => window.__clipboardWrites.length), 1, "denied copy adds no image");
    await page.evaluate(() => { window.__clipboardMode = "allow"; });
  });
  await step("Blank text disables exports and reset restores the Minecraft default", async () => {
    await page.getByRole("textbox", { name: "Текст заголовка", exact: true }).fill(" \n "); await waitHeading();
    await expect(page.getByRole("button", { name: "Скопировать PNG", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Скачать заголовок", exact: true })).toBeDisabled();
    assert.equal((await imageMetrics(await headingData())).opaque, 0);
    await page.getByRole("button", { name: "Сбросить заголовок", exact: true }).click(); await waitHeading();
    await expect(page.getByRole("textbox", { name: "Текст заголовка", exact: true })).toHaveValue("DAY 100");
    await expect(page.getByRole("button", { name: "Шрифт Minecraft", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Скачать заголовок", exact: true })).toBeEnabled();
    await page.screenshot({ path: path.join(artifacts, "heading-generator.png"), fullPage: true });
  });
  await step("Avatar validates skin dimensions and exports a custom transparent 1024 x 1024 PNG", async () => {
    await openTool("Создатель аватарок");
    const upload = page.getByLabel("Загрузить скин аватарки", { exact: true });
    await upload.setInputFiles(invalidFile); await expect(page.locator(".toast")).toContainText("Размер скина должен быть 64 × 64 или 64 × 32 пикселя");
    await upload.setInputFiles(skinFile); await expect(page.getByRole("button", { name: "Вернуть стандартного персонажа", exact: true })).toBeVisible();
    await expect(page.locator(".toast")).toContainText("Скин загружен");
    await page.getByRole("button", { name: "Поза и оформление", exact: true }).click();
    await page.getByRole("combobox", { name: "Поза аватарки", exact: true }).selectOption("0");
    await page.getByRole("checkbox", { name: "Тонкие руки (Alex)", exact: true }).check();
    await page.getByRole("checkbox", { name: "Прозрачный фон при экспорте", exact: true }).check();
    await expect(page.locator(".tp-avatar-stage canvas")).toBeVisible();
    const exported = await exportPng(page.getByRole("button", { name: "Скачать аватарку", exact: true }), "avatar.png", 1024, 1024, true);
    assert.ok(exported.metrics.pink > 1000, "export contains uploaded pink skin");
    await noOverflow("avatar tool");
  });
  await step("Circle tool exports a symmetric 17-block transparent PNG", async () => {
    await openTool("Пиксельные круги");
    await page.getByRole("spinbutton", { name: "Диаметр круга в блоках", exact: true }).fill("17");
    const circle = page.getByRole("img", { name: /^Круг диаметром 17 блоков/ }); await expect(circle).toBeVisible();
    const cells = await circle.locator(":scope > rect").evaluateAll(nodes => nodes.filter(node => !node.getAttribute("fill").startsWith("url")).map(node => [Math.round(Number(node.getAttribute("x"))), Math.round(Number(node.getAttribute("y")))]));
    const coordinates = new Set(cells.map(([x, y]) => x + "," + y));
    for (const [x, y] of cells) assert.ok(coordinates.has((16 - x) + "," + y) && coordinates.has(x + "," + (16 - y)), "circle symmetry");
    await exportPng(page.getByRole("button", { name: "Скачать схему PNG", exact: true }), "circle.png", 340, 340, true);
    await noOverflow("circle tool");
  });
  await step("Mobile dashboard and heading controls fit 390 px", async () => {
    await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: "Главное", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await page.keyboard.press("Escape");
    const dismiss = page.getByRole("button", { name: "Закрыть уведомление", exact: true }); if (await dismiss.count()) await dismiss.click();
    await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
    await expect.poll(async () => page.locator(".sidebar").evaluate(element => Math.round(element.getBoundingClientRect().right))).toBeLessThanOrEqual(0);
    await noOverflow("mobile dashboard"); await page.screenshot({ path: path.join(artifacts, "mobile.png"), fullPage: true });
    await openTool("Генератор заголовков"); await waitHeading();
    await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
    await expect(page.getByRole("button", { name: "Шрифт Minecraft", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Скачать заголовок", exact: true })).toBeEnabled();
    await noOverflow("mobile heading controls"); await page.screenshot({ path: path.join(artifacts, "heading-mobile.png"), fullPage: true });
  });
  await step("No browser runtime errors", async () => assert.deepEqual(runtimeErrors, []));
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: true, checks, runtimeErrors, consoleErrors }, null, 2));
  console.log("\nAll " + checks.length + " tool checks passed. Artifacts: " + artifacts);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: false, checks, error: error.stack || String(error), runtimeErrors, consoleErrors }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }

