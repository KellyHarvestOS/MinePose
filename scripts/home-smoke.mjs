import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts", "home");
await mkdir(artifacts, { recursive: true });
const catalog = JSON.parse(await readFile("src/data/item-catalog.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "ru-RU", acceptDownloads: true });
const page = await context.newPage(); page.setDefaultTimeout(30_000);
const checks = [], errors = [], consoleErrors = [], metrics = {};
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
const hero = () => page.locator(".hi-hero");
const actions = () => page.locator(".hi-quick-actions");
const heroCanvas = () => page.locator(".hv-scene canvas");
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function homeReady() { await expect(heroCanvas()).toBeVisible(); await expect(button("Сбросить ракурс сцены")).toBeEnabled(); await expect(page.locator(".hv-loading")).toHaveCount(0); await frames(); }
async function goHome() { await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: "Главное", exact: true }).click(); await homeReady(); }
async function editorReady() { await expect(page.locator(".pe-scene canvas")).toBeVisible(); await expect(page.locator(".pe-items-status")).toHaveCount(0); await frames(); }
async function projectFile(name) { const pending = page.waitForEvent("download"); await button("Скачать файл проекта").click(); const download = await pending; assert.equal(await download.failure(), null); const file = path.join(artifacts, name); await download.saveAs(file); return JSON.parse(await readFile(file, "utf8")); }
async function heroHash() { return createHash("sha256").update(await heroCanvas().evaluate(canvas => canvas.toDataURL("image/png"))).digest("hex"); }
async function pinkPixels() { return heroCanvas().evaluate(canvas => { const image = document.createElement("canvas"); image.width = canvas.width; image.height = canvas.height; const c = image.getContext("2d"); c.drawImage(canvas, 0, 0); const pixels = c.getImageData(0, 0, image.width, image.height).data; let pink = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 200 && pixels[i] > 150 && pixels[i + 2] > 90 && pixels[i + 1] < pixels[i] * .65) pink++; return pink; }); }
async function noOverflow(label) { const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width + 1, label + ": horizontal overflow " + JSON.stringify(size)); }
async function uploadVia(control, filename) { const pending = page.waitForEvent("filechooser"); await control.click(); await (await pending).setFiles(filename); }
async function libraryFocused() { await expect(page.locator("#pl-library-title")).toBeFocused(); await expect.poll(async () => page.locator("#pl-library-title").evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; })).toBe(true); }

try {
  const response = await page.goto(baseURL, { waitUntil: "networkidle" }); assert.equal(response?.status(), 200); await homeReady();
  await step("The homepage has one clear title, real scene, three equal action cards and actual product counts", async () => {
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator(".hi-title")).toHaveText("Твоя идея.Твой скин.Твоя сцена.");
    await expect(page.locator(".hi-eyebrow")).toHaveText("ТВОЯ MINECRAFT-МАСТЕРСКАЯ");
    await expect(button("Создать первую позу", hero())).toBeVisible();
    await expect(page.locator(".hi-action-card")).toHaveCount(3);
    const counts = await page.locator(".hi-stats strong").allTextContents(); assert.deepEqual(counts, ["12", String(catalog.length), "PNG"]);
    await expect(page.locator(".hv-error")).toHaveCount(0);
    await noOverflow("desktop homepage"); await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });
  });
  await step("Both creation actions open a real editable pose project", async () => {
    for (const source of ["hero", "card"]) {
      if (source === "hero") await button("Создать первую позу", hero()).click(); else await button("Новая поза", actions()).click();
      await editorReady(); const project = await projectFile(`blank-${source}.json`);
      assert.equal(project.kind, "pose"); assert.equal(project.name, "Новая поза"); assert.equal(Object.keys(project.pose).length, 6);
      await page.getByRole("spinbutton", { name: "Угол X в градусах", exact: true }).fill("17");
      assert.equal((await projectFile(`edited-${source}.json`)).pose.head.x, 17);
      await goHome();
    }
  });
  await step("The quiet link and templates action scroll to the existing library and focus its title", async () => {
    await button("Посмотреть готовые позы", hero()).click(); await libraryFocused();
    await hero().scrollIntoViewIfNeeded(); await button("Готовые позы", actions()).click(); await libraryFocused();
    await expect(page.locator(".pl-card")).toHaveCount(12);
    await hero().scrollIntoViewIfNeeded();
  });
  const fixtures = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const c = canvas.getContext("2d"); c.fillStyle = "#ed3c9a"; c.fillRect(0, 0, 64, 64);
    c.clearRect(32, 0, 32, 16); c.clearRect(0, 32, 64, 16); c.clearRect(0, 48, 16, 16); c.clearRect(48, 48, 16, 16);
    c.fillStyle = "#e0ae7e"; c.fillRect(8, 8, 8, 8); c.fillStyle = "#29222d"; c.fillRect(9, 11, 2, 1); c.fillRect(13, 11, 2, 1);
    const invalid = document.createElement("canvas"); invalid.width = invalid.height = 1;
    return { skin: canvas.toDataURL("image/png"), invalid: invalid.toDataURL("image/png") };
  });
  const skinFile = path.join(artifacts, "pink-skin.png"), invalidFile = path.join(artifacts, "invalid-skin.png");
  await writeFile(skinFile, Buffer.from(fixtures.skin.split(",")[1], "base64")); await writeFile(invalidFile, Buffer.from(fixtures.invalid.split(",")[1], "base64"));
  await step("Both upload actions use the real skin chooser and the custom skin reaches the scene and editor", async () => {
    await uploadVia(button("Загрузить скин", actions()), invalidFile); await expect(page.locator(".toast")).toContainText("Размер скина должен быть 64 × 64 или 64 × 32");
    await uploadVia(button("Загрузить скин", hero()), skinFile); await expect(page.locator(".toast")).toContainText("Скин загружен"); await homeReady();
    await expect(page.locator(".hv-skin-status")).toContainText("Твой скин");
    await expect.poll(pinkPixels).toBeGreaterThan(1000); metrics.customSkinPixels = await pinkPixels();
    assert.equal(await page.evaluate(() => localStorage.getItem("minepose-skin")), fixtures.skin);
    await button("Создать первую позу", hero()).click(); await editorReady(); assert.equal((await projectFile("custom-skin-blank.json")).scene.skin, fixtures.skin); await goHome();
    await button("Готовые позы", actions()).click(); await libraryFocused(); await button("Модель Slim").click();
    await button("Открыть позу: Искатель приключений").click(); await editorReady(); const preset = await projectFile("custom-skin-template.json");
    assert.equal(preset.scene.skin, fixtures.skin); assert.equal(preset.scene.slim, true); assert.equal(preset.scene.items.right.id, "diamond_sword"); await goHome();
  });
  await step("The hero is a live model that rotates, zooms and resets to the same camera", async () => {
    await hero().scrollIntoViewIfNeeded(); await homeReady(); await page.waitForLoadState("networkidle");
    const initial = await heroHash(), rect = await heroCanvas().boundingBox(); assert.ok(rect && rect.width > 200 && rect.height > 200);
    await page.mouse.move(rect.x + rect.width * .5, rect.y + rect.height * .5); await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .68, rect.y + rect.height * .57, { steps: 8 }); await page.mouse.up(); await frames();
    const rotated = await heroHash(); assert.notEqual(rotated, initial, "orbit changes actual rendered pixels");
    await page.mouse.wheel(0, -220); await frames(); assert.notEqual(await heroHash(), rotated, "zoom changes actual rendered pixels");
    await button("Сбросить ракурс сцены").click(); await frames(); assert.equal(await heroHash(), initial, "reset restores the initial live camera");
    await page.locator(".hi-hero").screenshot({ path: path.join(artifacts, "hero-custom-skin.png") });
  });
  await step("The hero and action cards fit desktop, tablet and 390/320px screens with large primary actions", async () => {
    metrics.viewports = [];
    for (const width of [1600, 1280, 1024, 760, 550, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 }); await page.keyboard.press("Escape");
      if (await button("Закрыть уведомление").count()) await button("Закрыть уведомление").click();
      await hero().scrollIntoViewIfNeeded(); await homeReady(); await noOverflow("homepage at " + width);
      const layout = await page.evaluate(() => {
        const rect = name => { const r = document.querySelector(name).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        return { content: rect(".hi-content"), visual: rect(".hi-visual-shell"), cards: Array.from(document.querySelectorAll(".hi-action-card"), element => element.getBoundingClientRect().height), actions: Array.from(document.querySelectorAll(".hi-cta"), element => element.getBoundingClientRect().height) };
      });
      assert.ok(Math.max(...layout.cards) - Math.min(...layout.cards) <= 1, width + " equal card heights: " + layout.cards);
      assert.ok(layout.actions.every(height => height >= 44), width + " CTA targets are at least 44px: " + layout.actions);
      assert.ok(layout.visual.width >= 200 && layout.visual.height >= 250, width + " useful 3D viewport");
      if (width >= 1280) assert.ok(layout.visual.x >= layout.content.right - 1, "desktop text and scene are side by side");
      else assert.ok(layout.visual.y >= layout.content.bottom - 1, "tablet/mobile scene follows the content");
      metrics.viewports.push({ width, ...layout });
      if ([1600, 1024, 390, 320].includes(width)) await page.locator(".hi-home-intro").screenshot({ path: path.join(artifacts, `intro-${width}.png`) });
    }
  });
  await step("The homepage has no browser runtime or resource errors", async () => { assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); });
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: true, checks, errors, consoleErrors, metrics }, null, 2));
  console.log(`\nAll ${checks.length} homepage checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: false, checks, errors, consoleErrors, metrics, error: error.stack || String(error) }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
