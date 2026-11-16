import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

// Uses an isolated browser profile: this script never reads or changes personal
// projects from your regular Chrome session. Start `npm run dev` before running it.
const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts");
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, locale: "ru-RU", acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const runtimeErrors = [];
const consoleErrors = [];
const checks = [];
page.on("pageerror", error => runtimeErrors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });

async function step(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function nav(name) {
  await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name, exact: true }).click();
}
async function savedProject(name) {
  return page.evaluate(({ name, key }) => JSON.parse(localStorage.getItem(key) || "[]").find(project => project.name === name), { name, key: "minepose-projects-v1" });
}
async function download(button, filename) {
  const event = page.waitForEvent("download");
  await button.click();
  const result = await event;
  assert.equal(await result.failure(), null, `Download failed: ${filename}`);
  const file = path.join(artifacts, filename);
  await result.saveAs(file);
  return { file, buffer: await readFile(file) };
}
async function png(button, filename, width, height, { transparent = false, minTransparentFraction = 1 / 3 } = {}) {
  const result = await download(button, filename);
  assert.deepEqual(result.buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${filename}: PNG signature`);
  assert.equal(result.buffer.readUInt32BE(16), width, `${filename}: exported width`);
  assert.equal(result.buffer.readUInt32BE(20), height, `${filename}: exported height`);
  const pixels = await page.evaluate(async dataUrl => {
    const image = new window.Image(); image.src = dataUrl; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
    const c = canvas.getContext("2d"); c.drawImage(image, 0, 0);
    const data = c.getImageData(0, 0, image.width, image.height).data;
    let opaque = 0; let clear = 0;
    for (let i = 3; i < data.length; i += 4) { if (data[i] > 240) opaque++; if (data[i] === 0) clear++; }
    return { cornerAlpha: data[3], opaque, clear };
  }, `data:image/png;base64,${result.buffer.toString("base64")}`);
  assert.ok(pixels.opaque > 500, `${filename}: export contains visible pixels`);
  assert.equal(pixels.cornerAlpha, transparent ? 0 : 255, `${filename}: background alpha`);
  if (transparent) assert.ok(pixels.clear > width * height * minTransparentFraction, `${filename}: expected transparent background`);
  return result;
}
async function noOverflow(label) {
  const dimensions = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(dimensions.page <= dimensions.viewport + 1, `${label}: horizontal overflow (${dimensions.page} > ${dimensions.viewport})`);
}
async function closeMobileOverlays() {
  await page.keyboard.press("Escape");
  const dismiss = page.getByRole("button", { name: "Закрыть уведомление", exact: true });
  if (await dismiss.count()) await dismiss.click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
  await expect.poll(async () => page.locator(".sidebar").evaluate(element => Math.round(element.getBoundingClientRect().right))).toBeLessThanOrEqual(0);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
}

try {
  await step("Desktop dashboard renders with a live WebGL scene", async () => {
    const response = await page.goto(baseURL, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200);
    await expect(page.getByRole("heading", { name: /Твоя идея\./ })).toBeVisible();
    await expect(page.locator(".hero-scene canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Открыть позу: Искатель приключений", exact: true })).toBeVisible();
    await noOverflow("desktop dashboard");
    await page.screenshot({ path: path.join(artifacts, "dashboard.png"), fullPage: true });
  });

  await step("Sidebar exposes four ordered tools without thumbnail creation or preview", async () => {
    const menu = page.getByRole("navigation", { name: "Главное меню" });
    await expect(menu.getByRole("button", { name: "Главное", exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Мастерская", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Миниатюры", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Новая миниатюра|Создать миниатюру|Собрать миниатюру|В миниатюру/ })).toHaveCount(0);
    const tools = menu.getByRole("button", { name: "Инструменты", exact: true });
    await expect(tools).toHaveAttribute("aria-expanded", "false");
    await tools.click();
    await expect(tools).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("heading", { name: /Твоя идея\./ })).toBeVisible();
    const expectedTools = ["Создатель аватарок", "Генератор заголовков", "Мастерская флагов", "Пиксельные круги"];
    const links = page.locator("#sidebar-tools").getByRole("button");
    await expect(links).toHaveCount(4);
    assert.deepEqual((await links.allTextContents()).map(text => text.trim()), expectedTools);
    await expect(menu.getByRole("button", { name: "Проверка миниатюры", exact: true })).toHaveCount(0);
    await tools.click();
    await expect(page.locator("#sidebar-tools")).toBeHidden();
    await expect(page.getByRole("heading", { name: /Твоя идея\./ })).toBeVisible();
  });

  await step("Pose editor: head slider, undo/redo and local save", async () => {
    await nav("Редактор поз");
    await expect(page.getByRole("heading", { name: /Каждая поза — история/ })).toBeVisible();
    await page.getByRole("button", { name: "Новый проект", exact: true }).click();
    await page.getByRole("textbox", { name: "Название проекта", exact: true }).fill("Smoke Pose");
    await expect(page.locator(".pe-viewport canvas")).toBeVisible();
    const slider = page.getByRole("slider", { name: "Вращение Голова: X", exact: true });
    await expect(slider).toHaveValue("0");
    await slider.focus();
    for (let i = 0; i < 4; i++) await slider.press("ArrowRight");
    await expect(slider).toHaveValue("4");
    await expect(page.getByRole("spinbutton", { name: "Угол X в градусах", exact: true })).toHaveValue("4");
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(slider).toHaveValue("3");
    await page.getByRole("button", { name: "Повторить", exact: true }).click();
    await expect(slider).toHaveValue("4");
    await page.getByRole("button", { name: "Сохранить позу", exact: true }).click();
    await expect.poll(async () => (await savedProject("Smoke Pose"))?.pose.head.x).toBe(4);
    await page.screenshot({ path: path.join(artifacts, "pose-editor.png"), fullPage: true });
  });

  await step("Saved pose survives reload and exports valid JSON", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Открыть Smoke Pose", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Угол X в градусах", exact: true })).toHaveValue("4");
    const result = await download(page.getByRole("button", { name: "Скачать файл проекта", exact: true }), "pose.minepose.json");
    const project = JSON.parse(result.buffer.toString("utf8"));
    assert.equal(project.kind, "pose"); assert.equal(project.name, "Smoke Pose"); assert.equal(project.pose.head.x, 4);
  });

  await step("Pose PNG export: exact size, transparent alpha and scene restoration", async () => {
    await page.getByRole("combobox", { name: "Разрешение PNG", exact: true }).selectOption("720");
    await page.getByRole("checkbox", { name: "Без фона", exact: true }).check();
    await png(page.getByRole("button", { name: "Скачать PNG", exact: true }), "pose-transparent.png", 720, 720, { transparent: true });
    await page.getByRole("checkbox", { name: "Без фона", exact: true }).uncheck();
    await png(page.getByRole("button", { name: "Скачать PNG", exact: true }), "pose.png", 720, 720);
    await expect(page.getByRole("spinbutton", { name: "Угол X в градусах", exact: true })).toHaveValue("4");
  });

  await step("Circle tool: editable diameter, filled shape and usable PNG", async () => {
    await nav("Инструменты");
    await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: "Пиксельные круги", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Диаметр круга в блоках", exact: true }).fill("17");
    const circle = page.getByRole("img", { name: /^Круг диаметром 17 блоков/ });
    await expect(circle).toBeVisible();
    const outlineCount = Number((await circle.getAttribute("aria-label")).match(/, (\d+) блоков/)[1]);
    await page.getByRole("checkbox", { name: "Заполнить круг", exact: true }).check();
    await expect.poll(async () => Number((await circle.getAttribute("aria-label")).match(/, (\d+) блоков/)[1])).toBeGreaterThan(outlineCount * 2);
    const cells = await circle.locator(":scope > rect").evaluateAll(nodes => nodes.filter(node => !node.getAttribute("fill").startsWith("url")).map(node => [Math.round(Number(node.getAttribute("x"))), Math.round(Number(node.getAttribute("y")))]));
    const coordinates = new Set(cells.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of cells) assert.ok(coordinates.has(`${16 - x},${y}`) && coordinates.has(`${x},${16 - y}`), "circle is symmetric on both axes");
    await png(page.getByRole("button", { name: "Скачать схему PNG", exact: true }), "circle.png", 340, 340, { transparent: true, minTransparentFraction: 0.1 });
    await noOverflow("circle tool");
  });

  await step("Single exported JSON restores a pose through the file chooser", async () => {
    const restoredContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "ru-RU" });
    try {
      const restored = await restoredContext.newPage(); restored.on("pageerror", error => runtimeErrors.push(error.stack || error.message));
      await restored.goto(baseURL, { waitUntil: "networkidle" });
      const chooser = restored.waitForEvent("filechooser");
      await restored.getByRole("button", { name: "Открыть JSON-файл", exact: true }).click();
      await (await chooser).setFiles(path.join(artifacts, "pose.minepose.json"));
      await expect(restored.getByRole("textbox", { name: "Название проекта", exact: true })).toHaveValue("Smoke Pose");
      await expect(restored.getByRole("spinbutton", { name: "Угол X в градусах", exact: true })).toHaveValue("4");
      const imported = await restored.evaluate(() => JSON.parse(localStorage.getItem("minepose-projects-v1") || "[]"));
      const original = JSON.parse(await readFile(path.join(artifacts, "pose.minepose.json"), "utf8"));
      assert.equal(imported.length, 1); assert.notEqual(imported[0].id, original.id); assert.equal(imported[0].pose.head.x, 4);
    } finally { await restoredContext.close(); }
  });

  await step("Full backup exports and restores all projects through the UI", async () => {
    await page.getByRole("button", { name: "Настройки", exact: true }).click();
    const backup = await download(page.getByRole("dialog").getByRole("button", { name: "Скачать", exact: true }), "minepose-backup.json");
    const exported = JSON.parse(backup.buffer.toString("utf8"));
    assert.equal(exported.version, 1); assert.equal(exported.projects.length, 1);
    assert.equal(exported.projects[0].kind, "pose"); assert.equal(exported.projects[0].name, "Smoke Pose");
    await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).click();
    const restoredContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "ru-RU" });
    try {
      const restored = await restoredContext.newPage(); restored.on("pageerror", error => runtimeErrors.push(error.stack || error.message));
      await restored.goto(baseURL, { waitUntil: "networkidle" });
      const chooser = restored.waitForEvent("filechooser");
      await restored.getByRole("button", { name: "Открыть JSON-файл", exact: true }).click();
      await (await chooser).setFiles(backup.file);
      await expect(restored.getByRole("button", { name: "Открыть Smoke Pose", exact: true })).toBeVisible();
      const imported = await restored.evaluate(() => JSON.parse(localStorage.getItem("minepose-projects-v1") || "[]"));
      assert.equal(imported.length, 1);
      for (const item of imported) assert.ok(!exported.projects.some(original => original.id === item.id), "restored projects get fresh IDs");
      assert.equal(imported.find(item => item.kind === "pose").pose.head.x, 4);
    } finally { await restoredContext.close(); }
  });

  await step("Mobile dashboard and drawer navigation fit a 390 px screen", async () => {
    await nav("Главное");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: /Твоя идея\./ })).toBeVisible();
    await closeMobileOverlays();
    await noOverflow("mobile dashboard");
    await page.screenshot({ path: path.join(artifacts, "mobile.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    await expect(page.getByRole("button", { name: "Закрыть меню", exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, "mobile-drawer.png"), fullPage: true, animations: "disabled" });
    const menu = page.getByRole("navigation", { name: "Главное меню" });
    const tools = menu.getByRole("button", { name: "Инструменты", exact: true });
    if (await tools.getAttribute("aria-expanded") === "true") await tools.click();
    await tools.click();
    await expect(tools).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".sidebar")).toHaveClass(/is-open/);
    await expect(page.getByRole("heading", { name: /Твоя идея\./ })).toBeVisible();
    await expect(page.locator("#sidebar-tools").getByRole("button")).toHaveCount(4);
    await expect(menu.getByRole("button", { name: "Проверка миниатюры", exact: true })).toHaveCount(0);
    await menu.getByRole("button", { name: "Пиксельные круги", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Пиксельные круги", exact: true })).toBeVisible();
    await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
    await noOverflow("mobile circle tool");
    await page.getByRole("button", { name: "Открыть меню", exact: true }).click();
    await menu.getByRole("button", { name: /^Мои проекты/ }).click();
    await expect(page.getByRole("heading", { name: /Твои идеи, по полочкам/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Открыть Smoke Pose", exact: true })).toBeVisible();
    await noOverflow("mobile projects");
  });

  await step("No browser runtime errors", async () => { assert.deepEqual(runtimeErrors, []); });
  await writeFile(path.join(artifacts, "smoke-report.json"), JSON.stringify({ baseURL, passed: true, checks, runtimeErrors, consoleErrors }, null, 2));
  console.log(`\nAll ${checks.length} smoke checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifacts, "smoke-report.json"), JSON.stringify({ baseURL, passed: false, checks, error: error.stack || String(error), runtimeErrors, consoleErrors }, null, 2));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
