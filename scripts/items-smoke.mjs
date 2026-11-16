import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

// All projects and files used here belong to an isolated Chrome profile.
const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts", "items");
await mkdir(artifacts, { recursive: true });
const catalog = JSON.parse(await readFile("src/data/item-catalog.json", "utf8"));
const browser = await chromium.launch({
  executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "ru-RU", acceptDownloads: true });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [], consoleErrors = [], checks = [];
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const button = name => page.getByRole("button", { name, exact: true });
const tab = name => page.getByRole("tab", { name, exact: true });
const number = name => page.getByRole("spinbutton", { name, exact: true });
const search = () => page.getByRole("searchbox", { name: "Поиск предметов", exact: true });
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function frames() { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready() {
  await expect(page.locator(".pe-viewport canvas")).toBeVisible();
  await expect(page.locator(".pe-items-status")).toHaveCount(0);
  await expect(button("Скачать PNG")).toBeEnabled();
  await frames();
}
async function setNumber(name, value) {
  await number(name).fill(String(value));
  await number(name).blur();
  await expect(number(name)).toHaveValue(String(value));
  await frames();
}
async function chooseItem(id) {
  const item = catalog.find(value => value.id === id); assert.ok(item, "catalog has " + id);
  await search().fill(id);
  await expect(page.locator(".ip-item-grid .ip-item")).toHaveCount(1);
  await button("Взять: " + item.name).click();
  await ready();
  await expect(page.locator(".ip-preview-status")).toHaveCount(0);
}
async function download(control, filename) {
  const pending = page.waitForEvent("download"); await control.click();
  const result = await pending; assert.equal(await result.failure(), null);
  const file = path.join(artifacts, filename); await result.saveAs(file);
  return await readFile(file);
}
async function projectFile(filename) { return JSON.parse((await download(button("Скачать файл проекта"), filename)).toString("utf8")); }
async function png(filename) {
  await ready();
  const buffer = await download(button("Скачать PNG"), filename);
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(buffer.readUInt32BE(16), 720); assert.equal(buffer.readUInt32BE(20), 720);
  return "data:image/png;base64," + buffer.toString("base64");
}
async function noOverflow(label) {
  const size = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(size.page <= size.viewport + 1, label + " has horizontal overflow: " + JSON.stringify(size));
}
async function saved() { return page.evaluate(() => JSON.parse(localStorage.getItem("minepose-projects-v1") || "[]").find(item => item.name === "Items Smoke")); }

try {
  const response = await page.goto(baseURL, { waitUntil: "networkidle" }); assert.equal(response?.status(), 200);
  await button("Создать первую позу").click();
  await page.getByRole("textbox", { name: "Название проекта", exact: true }).fill("Items Smoke");
  await ready();
  await tab("Предметы").click();

  await step("Items tab exposes the complete catalog, six categories and Russian/English search", async () => {
    assert.ok(catalog.length >= 300, "large extensible Minecraft catalog");
    await expect(page.locator(".ip-item-grid .ip-item")).toHaveCount(catalog.length);
    const category = page.getByRole("combobox", { name: "Категория предметов", exact: true });
    await expect(category.locator("option")).toHaveCount(7);
    await search().fill("алмазный меч"); await expect(page.locator(".ip-item-grid .ip-item")).toHaveCount(1);
    await expect(button("Взять: Алмазный меч")).toBeVisible();
    await search().fill("netherite"); await expect(page.locator(".ip-item-grid .ip-item")).toHaveCount(catalog.filter(item => item.id.includes("netherite")).length);
    await search().fill(""); await category.selectOption("food");
    await expect(page.locator(".ip-item-grid .ip-item")).toHaveCount(catalog.filter(item => item.category === "food").length);
    await category.selectOption("all"); await search().fill("несуществующий предмет 12345");
    await expect(page.locator(".ip-no-results")).toContainText("Ничего не найдено");
    await button("Сбросить поиск").click();
    await expect(page.locator(".ip-item-grid .ip-item")).toHaveCount(catalog.length);
    await noOverflow("desktop item catalog");
  });

  await step("Both hands equip real models independently and transforms participate in undo/redo", async () => {
    await chooseItem("diamond_sword");
    await setNumber("Правая рука: координата X", .35);
    await setNumber("Правая рука: угол Z", -30);
    await button("Левая рука").click();
    await chooseItem("shield");
    await setNumber("Левая рука: координата Y", .2);
    await setNumber("Левая рука: значение масштаба", 1.25);
    await setNumber("Левая рука: угол X", 75);
    await button("Отменить").click(); await expect(number("Левая рука: угол X")).toHaveValue("0");
    await button("Повторить").click(); await expect(number("Левая рука: угол X")).toHaveValue("75");
    await button("Правая рука").click();
    await expect(number("Правая рука: координата X")).toHaveValue("0.35");
    await expect(number("Правая рука: угол Z")).toHaveValue("-30");
    const data = await projectFile("two-hands.minepose.json");
    assert.equal(data.scene.items.right.id, "diamond_sword"); assert.equal(data.scene.items.left.id, "shield");
    assert.equal(data.scene.items.right.transform.position.x, .35); assert.equal(data.scene.items.left.transform.position.y, .2);
    assert.equal(data.scene.items.right.transform.rotation.z, -30); assert.equal(data.scene.items.left.transform.rotation.x, 75);
    assert.equal(data.scene.items.left.transform.scale, 1.25);
  });

  let skin;
  await step("Uploaded skin and Alex model preserve equipped objects through renderer reconstruction", async () => {
    skin = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
      const c = canvas.getContext("2d"); c.fillStyle = "#ed3c9a"; c.fillRect(0, 0, 64, 64);
      c.clearRect(32, 0, 32, 16); c.clearRect(0, 32, 64, 16); c.clearRect(0, 48, 16, 16); c.clearRect(48, 48, 16, 16);
      c.fillStyle = "#e0ae7e"; c.fillRect(8, 8, 8, 8); c.fillStyle = "#29222d"; c.fillRect(9, 11, 2, 1); c.fillRect(13, 11, 2, 1);
      return canvas.toDataURL("image/png");
    });
    const skinFile = path.join(artifacts, "pink-skin.png"); await writeFile(skinFile, Buffer.from(skin.split(",")[1], "base64"));
    await tab("Поза").click();
    await page.getByLabel("Файл скина", { exact: true }).setInputFiles(skinFile);
    await expect(page.locator(".toast")).toContainText("Скин загружен");
    const slim = page.getByRole("switch", { name: /Тонкие руки/ }); await slim.click(); await expect(slim).toHaveAttribute("aria-checked", "true");
    await ready(); await tab("Предметы").click();
    const data = await projectFile("alex-items.minepose.json");
    assert.equal(data.scene.slim, true); assert.equal(data.scene.skin, skin);
    assert.equal(data.scene.items.right.id, "diamond_sword"); assert.equal(data.scene.items.left.id, "shield");
    await button("Правая рука").click(); await expect(number("Правая рука: координата X")).toHaveValue("0.35");
  });

  await step("PNG contains the custom skin, alpha and visibly moved 3D objects at exact export dimensions", async () => {
    await page.getByRole("combobox", { name: "Разрешение PNG", exact: true }).selectOption("720");
    await page.getByRole("checkbox", { name: "Без фона", exact: true }).check();
    const before = await png("items-before.png");
    await setNumber("Правая рука: координата X", 1.4);
    const after = await png("items-after.png");
    const metrics = await page.evaluate(async ({ before, after }) => {
      async function pixels(url) { const image = new Image(); image.src = url; await image.decode(); const c = document.createElement("canvas"); c.width = c.height = 720; const context = c.getContext("2d"); context.drawImage(image, 0, 0); return context.getImageData(0, 0, 720, 720).data; }
      const a = await pixels(before), b = await pixels(after); let changed = 0, pink = 0, opaque = 0, clear = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]) > 25) changed++;
        if (b[i + 3] > 240) { opaque++; if (b[i] > b[i + 1] * 1.4 && b[i + 2] > b[i + 1] * 1.2 && b[i] > 100) pink++; }
        if (!b[i + 3]) clear++;
      }
      return { changed, pink, opaque, clear, cornerAlpha: b[3] };
    }, { before, after });
    assert.ok(metrics.changed > 800, "changing the actual 3D item changes PNG pixels: " + JSON.stringify(metrics));
    assert.ok(metrics.pink > 1000, "custom skin reaches export"); assert.ok(metrics.opaque > 10_000, "visible character and items");
    assert.equal(metrics.cornerAlpha, 0); assert.ok(metrics.clear > 720 * 720 / 3, "transparent background");
    await setNumber("Правая рука: координата X", .35);
  });

  await step("Saved hands and transforms survive reload and JSON import in a fresh browser profile", async () => {
    await button("Сохранить позу").click();
    await expect.poll(async () => (await saved())?.scene.items.left.transform.scale).toBe(1.25);
    await expect.poll(async () => (await saved())?.scene.items.right.transform.position.x).toBe(.35);
    await projectFile("saved-items.minepose.json");
    await page.reload({ waitUntil: "networkidle" }); await button("Открыть Items Smoke").click(); await ready();
    await tab("Предметы").click(); await expect(number("Правая рука: координата X")).toHaveValue("0.35");
    await button("Левая рука").click(); await expect(number("Левая рука: значение масштаба")).toHaveValue("1.25");
    await expect(number("Левая рука: угол X")).toHaveValue("75");
    const importedContext = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce", locale: "ru-RU" });
    try {
      const importedPage = await importedContext.newPage(); importedPage.on("pageerror", error => errors.push(error.stack || error.message));
      await importedPage.goto(baseURL, { waitUntil: "networkidle" });
      const chooser = importedPage.waitForEvent("filechooser"); await importedPage.getByRole("button", { name: "Открыть JSON-файл", exact: true }).click();
      await (await chooser).setFiles(path.join(artifacts, "saved-items.minepose.json"));
      await expect(importedPage.getByRole("textbox", { name: "Название проекта", exact: true })).toHaveValue("Items Smoke");
      const data = await importedPage.evaluate(() => JSON.parse(localStorage.getItem("minepose-projects-v1") || "[]")[0]);
      assert.equal(data.scene.items.right.id, "diamond_sword"); assert.equal(data.scene.items.left.id, "shield");
      assert.equal(data.scene.items.left.transform.scale, 1.25); assert.equal(data.scene.skin, skin); assert.equal(data.scene.slim, true);
    } finally { await importedContext.close(); }
  });

  await step("Reset and removal affect only the selected hand and can be undone", async () => {
    await button("Сбросить положение предмета в левой руке").click();
    await expect(number("Левая рука: координата Y")).toHaveValue("0"); await expect(number("Левая рука: угол X")).toHaveValue("0"); await expect(number("Левая рука: значение масштаба")).toHaveValue("1");
    await button("Убрать предмет из левой руки").click(); await expect(page.locator(".ip-empty-hand")).toContainText("Левая рука свободна");
    await ready(); await button("Отменить").click(); await ready(); await expect(number("Левая рука: значение масштаба")).toHaveValue("1");
    await button("Правая рука").click(); await expect(number("Правая рука: координата X")).toHaveValue("0.35");
    await search().fill(""); await page.screenshot({ path: path.join(artifacts, "items-desktop.png"), fullPage: true });
  });

  await step("Items catalog and transform controls fit 390px and 320px screens", async () => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 }); await page.keyboard.press("Escape");
      if (await button("Закрыть уведомление").count()) await button("Закрыть уведомление").click();
      await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
      await noOverflow("items at " + width + "px");
      await tab("Предметы").scrollIntoViewIfNeeded(); await expect(tab("Предметы")).toBeVisible();
      await search().fill("dirt"); await expect(page.locator(".ip-item-grid .ip-item")).toHaveCount(catalog.filter(item => `${item.name} ${item.id} ${(item.keywords || []).join(" ")}`.toLowerCase().includes("dirt")).length);
      await button("Левая рука").click(); await expect(number("Левая рука: значение масштаба")).toHaveValue("1");
      await noOverflow("item controls at " + width + "px");
      await page.screenshot({ path: path.join(artifacts, `items-mobile-${width}.png`), fullPage: true });
    }
  });
  await step("No browser runtime or console errors", async () => { assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); });
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: true, checks, errors, consoleErrors }, null, 2));
  console.log(`\nAll ${checks.length} item checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ baseURL, passed: false, checks, errors, consoleErrors, error: error.stack || String(error) }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
