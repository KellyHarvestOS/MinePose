import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts", "pose-library");
await mkdir(artifacts, { recursive: true });
const catalog = await readFile("src/data/item-catalog.json", "utf8");
const sourceItems = (await readFile("src/lib/items.ts", "utf8")).replace(/import catalog from ["']@\/data\/item-catalog\.json["'];?/, `const catalog = ${catalog};`);
const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 };
const moduleURL = source => "data:text/javascript;base64," + Buffer.from(ts.transpileModule(source, { compilerOptions }).outputText).toString("base64");
const itemsURL = moduleURL(sourceItems);
const sourcePresets = (await readFile("src/lib/pose-presets.ts", "utf8")).replace(/from ["'](?:\.\/items|@\/lib\/items)["']/g, `from ${JSON.stringify(itemsURL)}`);
const { PRESETS } = await import(moduleURL(sourcePresets));
assert.equal(PRESETS.length, 12);

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "ru-RU", acceptDownloads: true });
const page = await context.newPage(); page.setDefaultTimeout(40_000);
const checks = [], errors = [], consoleErrors = [], metrics = {};
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const button = name => page.getByRole("button", { name, exact: true });
const search = () => page.getByRole("searchbox", { name: "Поиск готовых поз", exact: true });
const category = () => page.getByRole("combobox", { name: "Категория готовых поз", exact: true });
const sort = () => page.getByRole("combobox", { name: "Сортировка готовых поз", exact: true });
const card = id => page.locator(`.pl-card[data-preset="${id}"]`);
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function previewsReady(count = 12) {
  await expect(page.locator(".pl-card")).toHaveCount(count);
  await expect(page.locator(".pl-card .pose-preview[data-preview-ready='true']")).toHaveCount(count, { timeout: 45_000 });
  await expect(page.locator(".pl-card .pp-error")).toHaveCount(0);
  await frames();
}
async function canvasData(locator) { return locator.evaluate(canvas => canvas.toDataURL("image/png")); }
async function canvasHash(locator) { return createHash("sha256").update(await canvasData(locator)).digest("hex"); }
async function noOverflow(label) { const size = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth })); assert.ok(size.page <= size.viewport + 1, `${label}: ${size.page} > ${size.viewport}`); }
async function resetFilters() {
  await search().fill(""); await category().selectOption("all"); await sort().selectOption("default");
  if (await button("Только избранные позы").getAttribute("aria-pressed") === "true") await button("Только избранные позы").click();
}
async function quickReady() {
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".pl-quick-scene canvas")).toBeVisible();
  await expect(page.locator(".pl-quick-loading")).toHaveCount(0);
  await expect(page.locator(".pl-quick-error")).toHaveCount(0);
  await frames();
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  const skin = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const c = canvas.getContext("2d"); c.fillStyle = "#ed3c9a"; c.fillRect(0, 0, 64, 64);
    c.clearRect(32, 0, 32, 16); c.clearRect(0, 32, 64, 16); c.clearRect(0, 48, 16, 16); c.clearRect(48, 48, 16, 16);
    c.fillStyle = "#dca77e"; c.fillRect(8, 8, 8, 8); c.fillStyle = "#28202d"; c.fillRect(9, 11, 2, 1); c.fillRect(13, 11, 2, 1);
    const data = canvas.toDataURL("image/png"); localStorage.setItem("minepose-skin", data); localStorage.setItem("minepose-slim", "false"); return data;
  });
  await page.reload({ waitUntil: "networkidle" });

  await step("Twelve actual 3D previews have unique silhouettes, custom skins and unclipped framing in a four-column grid", async () => {
    await previewsReady();
    const columns = await page.locator(".pl-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length); assert.equal(columns, 4);
    const previews = await page.locator(".pl-card .pose-preview canvas").evaluateAll(canvases => canvases.map(canvas => {
      const c = canvas.getContext("2d"), pixels = c.getImageData(0, 0, canvas.width, canvas.height).data;
      let opaque = 0, pink = 0, clear = 0;
      const bounds = { left: canvas.width, top: canvas.height, right: -1, bottom: -1 };
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 230) {
          opaque++; const x = i / 4 % canvas.width, y = Math.floor(i / 4 / canvas.width);
          bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x); bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
          if (pixels[i] > 100 && pixels[i + 2] > 80 && pixels[i] > pixels[i + 1] * 1.3 && pixels[i + 2] > pixels[i + 1] * 1.1) pink++;
        }
        if (pixels[i + 3] === 0) clear++;
      }
      return { id: canvas.closest(".pl-card").dataset.preset, width: canvas.width, height: canvas.height, opaque, pink, clear, bounds, url: canvas.toDataURL("image/png") };
    }));
    const hashes = new Set();
    for (const preview of previews) {
      hashes.add(createHash("sha256").update(preview.url).digest("hex"));
      assert.ok(preview.opaque > 500, preview.id + " real visible model"); assert.ok(preview.pink > 500, preview.id + " custom skin");
      assert.ok(preview.clear > preview.width * preview.height * .15, preview.id + " real transparent silhouette");
      assert.ok(preview.bounds.left > 1 && preview.bounds.top > 1 && preview.bounds.right < preview.width - 2 && preview.bounds.bottom < preview.height - 2, preview.id + " frame has breathing room");
      await writeFile(path.join(artifacts, preview.id + ".png"), Buffer.from(preview.url.split(",")[1], "base64")); delete preview.url;
    }
    assert.equal(hashes.size, 12); metrics.previews = previews;
    const sizes = await page.locator(".pl-card").evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    assert.equal(new Set(sizes.map(value => value.join(","))).size, 1, "all card sizes match");
    await noOverflow("desktop library"); await page.locator(".pl-library").screenshot({ path: path.join(artifacts, "library-desktop.png") });
  });

  await step("Search, every category and genuine name/category sorting operate on all twelve presets", async () => {
    const normalize = value => value.toLocaleLowerCase("ru").replaceAll("ё", "е");
    await search().fill("приключения"); await expect(page.locator(".pl-card")).toHaveCount(PRESETS.filter(preset => normalize(`${preset.name} ${preset.category} ${preset.description}`).includes("приключения")).length);
    await search().fill("Шахтёр"); await expect(page.locator(".pl-card")).toHaveCount(1); await expect(card("miner")).toBeVisible();
    await search().fill("несуществующая поза 12345"); await expect(page.locator(".pl-empty")).toBeVisible(); await button("Показать все позы").click();
    const categories = [...new Set(PRESETS.map(preset => preset.category))]; await expect(category().locator("option")).toHaveCount(categories.length + 1);
    for (const value of categories) { await category().selectOption({ label: value }); await expect(page.locator(".pl-card")).toHaveCount(PRESETS.filter(preset => preset.category === value).length); }
    await category().selectOption("all"); await sort().selectOption("name");
    assert.deepEqual(await page.locator(".pl-card").evaluateAll(nodes => nodes.map(node => node.dataset.preset)), [...PRESETS].sort((a, b) => a.name.localeCompare(b.name, "ru")).map(preset => preset.id));
    await sort().selectOption("category");
    assert.deepEqual(await page.locator(".pl-card").evaluateAll(nodes => nodes.map(node => node.dataset.preset)), [...PRESETS].sort((a, b) => a.category.localeCompare(b.category, "ru") || a.name.localeCompare(b.name, "ru")).map(preset => preset.id));
    assert.equal((await sort().allTextContents()).join(" ").includes("популяр"), false);
    await resetFilters(); await previewsReady();
  });

  await step("Favorites persist across reload and remain independent of sorting and search", async () => {
    for (const id of ["adventure", "jump", "defender"]) { const preset = PRESETS.find(value => value.id === id); await button("Добавить в избранное: " + preset.name).click(); }
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("minepose-pose-favorites-v1"))), ["adventure", "jump", "defender"]);
    await button("Только избранные позы").click(); await expect(page.locator(".pl-card")).toHaveCount(3);
    await page.reload({ waitUntil: "networkidle" }); await previewsReady();
    for (const id of ["adventure", "jump", "defender"]) { const preset = PRESETS.find(value => value.id === id); await expect(button("Убрать из избранного: " + preset.name)).toHaveAttribute("aria-pressed", "true"); }
    await button("Только избранные позы").click(); await expect(page.locator(".pl-card")).toHaveCount(3);
    await search().fill("прыжок"); await expect(page.locator(".pl-card")).toHaveCount(1);
    await button("Убрать из избранного: " + PRESETS.find(value => value.id === "jump").name).click(); await expect(page.locator(".pl-empty")).toBeVisible();
    await resetFilters(); await previewsReady();
  });

  await step("Classic and Slim genuinely rebuild all previews while preserving the selected skin", async () => {
    const before = await canvasHash(card("adventure").locator("canvas"));
    await button("Модель Slim").click(); await expect(button("Модель Slim")).toHaveAttribute("aria-pressed", "true");
    await previewsReady(); await expect.poll(() => canvasHash(card("adventure").locator("canvas"))).not.toBe(before);
    assert.equal(await page.evaluate(() => localStorage.getItem("minepose-skin")), skin); assert.equal(await page.evaluate(() => localStorage.getItem("minepose-slim")), "true");
  });

  await step("Quick view traps focus, rotates and zooms the real model, resets its camera and opens the editor", async () => {
    const preset = PRESETS.find(value => value.id === "defender");
    const preview = button("Быстрый просмотр: " + preset.name); await preview.click(); await quickReady();
    const close = button("Закрыть быстрый просмотр"), open = button("Открыть позу в редакторе: " + preset.name);
    await expect(close).toBeFocused(); await page.keyboard.press("Shift+Tab"); await expect(open).toBeFocused(); await page.keyboard.press("Tab"); await expect(close).toBeFocused();
    const canvas = page.locator(".pl-quick-scene canvas"), initial = await canvasHash(canvas), bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .45); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .65, bounds.y + bounds.height * .5, { steps: 10 }); await page.mouse.up(); await frames();
    assert.notEqual(await canvasHash(canvas), initial, "drag changes real 3D pixels");
    const rotated = await canvasHash(canvas); await canvas.hover(); await page.mouse.wheel(0, -200); await frames(); await expect.poll(() => canvasHash(canvas)).not.toBe(rotated);
    await button("Сбросить ракурс позы").click(); await frames(); await expect.poll(() => canvasHash(canvas)).toBe(initial);
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0); await expect(preview).toBeFocused(); assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    await preview.click(); await quickReady(); await page.mouse.click(3, 3); await expect(page.getByRole("dialog")).toHaveCount(0);
    await preview.click(); await quickReady(); await open.click(); await expect(page.getByRole("textbox", { name: "Название проекта", exact: true })).toHaveValue(preset.name);
    await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: "Главное", exact: true }).click(); await previewsReady();
  });

  await step("Favorites failures are reported without pretending to save or damaging other browser data", async () => {
    const deniedContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    try {
      await deniedContext.addInitScript(() => {
        const originalGet = Storage.prototype.getItem, originalSet = Storage.prototype.setItem;
        window.__favoritesDenyRead = true; window.__favoritesDenyWrite = true;
        Storage.prototype.getItem = function(key) { if (key === "minepose-pose-favorites-v1" && window.__favoritesDenyRead) throw new DOMException("Test denied read", "SecurityError"); return originalGet.call(this, key); };
        Storage.prototype.setItem = function(key, value) { if (key === "minepose-pose-favorites-v1" && window.__favoritesDenyWrite) throw new DOMException("Test denied write", "QuotaExceededError"); return originalSet.call(this, key, value); };
      });
      const denied = await deniedContext.newPage(); await denied.goto(baseURL, { waitUntil: "networkidle" });
      await expect(denied.locator(".toast")).toContainText("Не удалось прочитать избранные позы");
      const first = PRESETS[0], favorite = denied.getByRole("button", { name: "Добавить в избранное: " + first.name, exact: true });
      await favorite.click(); await expect(denied.locator(".toast")).toContainText("Браузер не разрешил сохранить избранное"); await expect(favorite).toHaveAttribute("aria-pressed", "false");
      await denied.evaluate(() => { window.__favoritesDenyRead = false; });
      assert.equal(await denied.evaluate(() => localStorage.getItem("minepose-pose-favorites-v1")), null);
    } finally { await deniedContext.close(); }
  });

  await step("Responsive cards keep equal proportions and all controls fit tablet, 390px and 320px screens", async () => {
    for (const width of [1150, 1000, 550, 390, 320]) {
      await page.setViewportSize({ width, height: 950 }); await page.keyboard.press("Escape");
      if (await button("Закрыть уведомление").count()) await button("Закрыть уведомление").click();
      await previewsReady(); await noOverflow("library at " + width);
      const columns = await page.locator(".pl-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      assert.equal(columns, width === 1150 ? 3 : width >= 420 ? 2 : 1, "responsive columns at " + width);
      if (width <= 390) await page.locator(".pl-library").screenshot({ path: path.join(artifacts, `library-mobile-${width}.png`) });
      await button("Быстрый просмотр: " + PRESETS[0].name).click(); await quickReady(); await noOverflow("quick view at " + width); await page.keyboard.press("Escape");
    }
  });
  await step("The library has no runtime or resource errors", async () => { assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); });
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: true, checks, errors, consoleErrors, metrics }, null, 2));
  console.log(`\nAll ${checks.length} pose-library checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: false, checks, errors, consoleErrors, metrics, error: error.stack || String(error) }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
