import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts", "banner");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, locale: "ru-RU", acceptDownloads: true, reducedMotion: "reduce" });
// Verify the copied payload without writing to the user's operating-system clipboard.
await context.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async text => { window.__bannerClipboard = text; } } });
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const errors = [], consoleErrors = [], checks = [];
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const command = () => page.getByRole("textbox", { name: "Команда выдачи флага", exact: true });
const currentCommand = () => command().inputValue();
const patternCount = text => (text.match(/pattern:"minecraft:/g) || []).length;
const bare = { base: "white", layers: [] };
const overlapping = { base: "white", layers: [
  { id: "lower-blue", pattern: "half_vertical", color: "blue" },
  { id: "upper-red", pattern: "half_horizontal", color: "red" },
] };

async function step(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function openBanner() {
  const nav = page.getByRole("navigation", { name: "Главное меню" });
  const tools = nav.getByRole("button", { name: "Инструменты", exact: true });
  if (await tools.getAttribute("aria-expanded") !== "true") await tools.click();
  await nav.getByRole("button", { name: "Мастерская флагов", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Мастерская флагов", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Предпросмотр флага Minecraft", exact: true })).toBeVisible();
}
async function importDesign(design) {
  await page.getByLabel("Файл проекта флага", { exact: true }).setInputFiles({ name: "banner-test.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(design)) });
}
async function download(button, filename) {
  const waiting = page.waitForEvent("download"); await button.click(); const item = await waiting;
  assert.equal(await item.failure(), null);
  const file = path.join(artifacts, filename); await item.saveAs(file);
  return { file, buffer: await readFile(file) };
}
async function png(filename) {
  const result = await download(page.getByRole("button", { name: "Скачать флаг PNG", exact: true }), filename);
  assert.deepEqual(result.buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(result.buffer.readUInt32BE(16), 400); assert.equal(result.buffer.readUInt32BE(20), 800);
  const metrics = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const c = canvas.getContext("2d"); c.drawImage(image, 0, 0);
    const pixels = c.getImageData(0, 0, image.width, image.height).data;
    let opaque = 0; const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) { if (pixels[i + 3] === 255) opaque++; colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`); }
    return { opaque, colors: colors.size, topLeft: [...c.getImageData(40, 80, 1, 1).data] };
  }, `data:image/png;base64,${result.buffer.toString("base64")}`);
  assert.equal(metrics.opaque, 400 * 800, "Export is the banner cloth, without a background or pole surrounding it");
  assert.ok(metrics.colors > 2, "Vanilla cloth shading and layered pattern pixels are present");
  return { ...result, metrics };
}
async function noOverflow(label) {
  const size = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.content <= size.viewport + 1, `${label}: horizontal overflow ${size.content} > ${size.viewport}`);
}

try {
  assert.equal((await page.goto(baseURL, { waitUntil: "networkidle" }))?.status(), 200);
  await openBanner(); await page.evaluate(() => document.fonts.ready);

  await step("Vanilla banner editor has 16 dyes and all 42 distinct patterns, including Flow and Guster", async () => {
    await expect(page.getByRole("group", { name: "Цвет основы", exact: true }).getByRole("button")).toHaveCount(16);
    await expect(page.getByRole("group", { name: "Цвет узора", exact: true }).getByRole("button")).toHaveCount(16);
    const labels = [];
    for (const [tab, count] of [["Полосы", 9], ["Фигуры", 25], ["Символы", 8]]) {
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      const buttons = page.getByRole("group", { name: "Узоры флага", exact: true }).getByRole("button");
      await expect(buttons).toHaveCount(count);
      labels.push(...await buttons.evaluateAll(items => items.map(item => item.getAttribute("aria-label"))));
    }
    assert.equal(new Set(labels).size, 42);
    await expect(page.getByRole("button", { name: "Узор: Поток", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Узор: Вихрь", exact: true })).toBeVisible();
    await expect.poll(() => page.locator(".bm-stage-footer").innerText()).not.toContain("Загружаем");
    await page.screenshot({ path: path.join(artifacts, "banner-desktop.png"), fullPage: true });
    await noOverflow("desktop banner editor");
  });

  await step("Base dye and chosen layer pattern/color change the actual rendered PNG", async () => {
    await importDesign(bare);
    await expect(command()).toHaveValue("/give @p minecraft:white_banner 1");
    await page.getByRole("button", { name: "Цвет основы: Синий", exact: true }).click();
    await expect(command()).toHaveValue("/give @p minecraft:blue_banner 1");
    await importDesign(overlapping);
    await expect(command()).toHaveValue(/half_vertical.*half_horizontal/);
    const first = await png("overlap-before.png");
    assert.ok(first.metrics.topLeft[0] > first.metrics.topLeft[2] * 1.5, "Upper red half covers lower blue half at their overlap");
    await page.getByRole("tab", { name: /^Фигуры/ }).click();
    await page.getByRole("button", { name: "Узор: Ромб", exact: true }).click();
    await page.getByRole("button", { name: "Цвет узора: Лаймовый", exact: true }).click();
    await expect(command()).toHaveValue(/half_vertical.*rhombus.*color:"lime"/);
    const edited = await png("layer-edited.png");
    assert.notDeepEqual(first.buffer, edited.buffer, "Changing a layer must change the exported image");
  });

  await step("Layer reordering follows actual paint order and Java /give command order", async () => {
    await importDesign(overlapping);
    await expect(command()).toHaveValue(/half_vertical.*half_horizontal/);
    await page.getByRole("button", { name: "Опустить слой 2", exact: true }).click();
    await expect(command()).toHaveValue(/half_horizontal.*half_vertical/);
    const reordered = await png("overlap-reordered.png");
    assert.ok(reordered.metrics.topLeft[2] > reordered.metrics.topLeft[0] * 1.5, "Blue half now paints last in their overlap");
    await page.getByRole("button", { name: "Скопировать /give", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__bannerClipboard)).toBe(await currentCommand());
    assert.match(await currentCommand(), /^\/give @p minecraft:white_banner\[minecraft:banner_patterns=\[/);
  });

  await step("Delete, undo and redo preserve complete banner layers", async () => {
    const original = await currentCommand();
    await page.getByRole("button", { name: "Удалить слой 2", exact: true }).click();
    await expect.poll(async () => patternCount(await currentCommand())).toBe(1);
    await page.getByRole("button", { name: "Отменить изменение флага", exact: true }).click();
    await expect(command()).toHaveValue(original);
    await page.getByRole("button", { name: "Повторить изменение флага", exact: true }).click();
    await expect.poll(async () => patternCount(await currentCommand())).toBe(1);
  });

  let exportedDesign, exportedCommand;
  await step("Six-layer loom limit prevents a seventh layer while allowing pattern replacement", async () => {
    const add = page.getByRole("button", { name: "Добавить", exact: true });
    for (let i = 0; i < 5; i++) await add.click();
    await expect(add).toBeDisabled();
    await expect.poll(async () => patternCount(await currentCommand())).toBe(6);
    await page.getByRole("tab", { name: /^Символы/ }).click();
    await page.getByRole("button", { name: "Узор: Вихрь", exact: true }).click();
    await expect(command()).toHaveValue(/minecraft:guster/);
    assert.equal(patternCount(await currentCommand()), 6);
    const exported = await download(page.getByRole("button", { name: "Скачать проект JSON", exact: true }), "banner-project.json");
    exportedDesign = JSON.parse(exported.buffer.toString("utf8")); exportedCommand = await currentCommand();
    assert.equal(exportedDesign.layers.length, 6); assert.equal(exportedDesign.layers.at(-1).pattern, "guster");
  });

  await step("JSON import validates loom designs and local saves survive page reload", async () => {
    await importDesign({ base: "white", layers: [...exportedDesign.layers, { id: "seventh", pattern: "creeper", color: "black" }] });
    await expect(page.getByRole("status")).toContainText("не больше 6");
    await expect(command()).toHaveValue(exportedCommand);
    await page.getByRole("button", { name: "Сбросить флаг", exact: true }).click();
    await importDesign(exportedDesign); await expect(command()).toHaveValue(exportedCommand);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("minepose-banner-v1")).layers.length)).toBe(6);
    await page.reload({ waitUntil: "networkidle" }); await openBanner();
    await expect(command()).toHaveValue(exportedCommand);
  });

  await step("Banner editor fits a 390 px screen and exports a full 400 × 800 PNG", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow("mobile banner editor");
    await png("banner-mobile-export.png");
    const toast = page.getByRole("button", { name: "Закрыть уведомление", exact: true });
    if (await toast.isVisible()) await toast.click();
    await page.screenshot({ path: path.resolve("artifacts", "banner-mobile.png"), fullPage: true });
  });
  assert.deepEqual(errors, [], "No runtime errors");
  assert.deepEqual(consoleErrors, [], "No browser console errors");
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: true, checks, errors, consoleErrors }, null, 2));
  console.log(`All ${checks.length} banner checks passed.`);
} catch (error) {
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: false, checks, error: error.stack || error.message, errors, consoleErrors }, null, 2));
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
