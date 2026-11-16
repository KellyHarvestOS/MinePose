import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts", "presets");
await mkdir(artifacts, { recursive: true });
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const catalog = JSON.parse(await readFile("src/data/item-catalog.json", "utf8"));
const itemSource = compile(await readFile("src/lib/items.ts", "utf8")).replace(/import catalog from "@\/data\/item-catalog\.json";/, `const catalog = ${JSON.stringify(catalog)};`);
const presetSource = compile(await readFile("src/lib/pose-presets.ts", "utf8")).replace('from "./items"', `from "${moduleUrl(itemSource)}"`);
const { PRESETS } = await import(moduleUrl(presetSource));
const browser = await chromium.launch({
  executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "ru-RU", acceptDownloads: true });
await context.addInitScript(() => {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d"); c.fillStyle = "#ed3c9a"; c.fillRect(0, 0, 64, 64);
  c.clearRect(32, 0, 32, 16); c.clearRect(0, 32, 64, 16); c.clearRect(0, 48, 16, 16); c.clearRect(48, 48, 16, 16);
  c.fillStyle = "#e0ae7e"; c.fillRect(8, 8, 8, 8); c.fillStyle = "#29222d"; c.fillRect(9, 11, 2, 1); c.fillRect(13, 11, 2, 1);
  localStorage.setItem("minepose-skin", canvas.toDataURL("image/png"));
  localStorage.setItem("minepose-slim", "true");
});
const page = await context.newPage(); page.setDefaultTimeout(30_000);
const checks = [], errors = [], consoleErrors = [], captures = [], imageHashes = new Set();
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const button = (name, target = page) => target.getByRole("button", { name, exact: true });
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function frames(target = page) { await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function ready(target = page) {
  await expect(target.locator(".pe-scene canvas")).toBeVisible();
  await expect(target.locator(".pe-items-status")).toHaveCount(0);
  await expect(button("Скачать PNG", target)).toBeEnabled();
  await frames(target);
}
async function download(control, filename, target = page) {
  const pending = target.waitForEvent("download"); await control.click(); const result = await pending;
  assert.equal(await result.failure(), null);
  const file = path.join(artifacts, filename); await result.saveAs(file);
  return await readFile(file);
}
async function projectFile(filename, target = page) { return JSON.parse((await download(button("Скачать файл проекта", target), filename, target)).toString("utf8")); }
function verifyProject(project, preset, skin) {
  assert.deepEqual(project.pose, preset.pose, preset.id + " full pose");
  assert.deepEqual(project.scene.modelPosition, preset.position, preset.id + " model position");
  assert.deepEqual(project.scene.modelRotation, preset.rotation, preset.id + " model rotation");
  assert.deepEqual(project.scene.items, preset.items, preset.id + " equipped items");
  assert.deepEqual(project.scene.previewCamera, preset.camera, preset.id + " camera recommendation");
  assert.equal(project.scene.skin, skin, preset.id + " retains user skin");
  assert.equal(project.scene.slim, true, preset.id + " retains Alex model");
}
async function png(preset) {
  const buffer = await download(button("Скачать PNG"), `editor-${preset.id}.png`);
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(buffer.readUInt32BE(16), 720); assert.equal(buffer.readUInt32BE(20), 720);
  const url = "data:image/png;base64," + buffer.toString("base64");
  const metrics = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 720;
    const c = canvas.getContext("2d"); c.drawImage(image, 0, 0);
    const p = c.getImageData(0, 0, 720, 720).data;
    const bounds = { left: 720, top: 720, right: -1, bottom: -1 }; let pink = 0, visible = 0, clear = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] > 20) {
        visible++; const x = i / 4 % 720, y = Math.floor(i / 4 / 720);
        bounds.left = Math.min(bounds.left, x); bounds.right = Math.max(bounds.right, x);
        bounds.top = Math.min(bounds.top, y); bounds.bottom = Math.max(bounds.bottom, y);
        if (p[i] > 100 && p[i] > p[i + 1] * 1.4 && p[i + 2] > p[i + 1] * 1.2) pink++;
      }
      if (!p[i + 3]) clear++;
    }
    return { bounds, pink, visible, clear, cornerAlpha: p[3] };
  }, url);
  assert.ok(metrics.visible > 4000, preset.id + " visible model");
  assert.ok(metrics.pink > 2000, preset.id + " actual custom pink skin");
  assert.ok(metrics.clear > 720 * 720 / 3, preset.id + " transparent background");
  assert.equal(metrics.cornerAlpha, 0);
  assert.ok(metrics.bounds.left > 4 && metrics.bounds.top > 4 && metrics.bounds.right < 715 && metrics.bounds.bottom < 715, preset.id + " full model and items inside export bounds: " + JSON.stringify(metrics.bounds));
  imageHashes.add(createHash("sha256").update(buffer).digest("hex"));
  captures.push({ id: preset.id, name: preset.name, url, metrics });
}

try {
  await step("Twelve source presets have unique real rotations, valid positions and actual catalog items", async () => {
    assert.equal(PRESETS.length, 12); assert.equal(new Set(PRESETS.map(preset => preset.id)).size, 12);
    assert.equal(new Set(PRESETS.map(preset => JSON.stringify(preset.pose))).size, 12);
    for (const preset of PRESETS) {
      assert.equal(Object.keys(preset.pose).length, 6);
      for (const part of Object.values(preset.pose)) for (const value of Object.values(part)) assert.ok(Number.isFinite(value) && Math.abs(value) <= 180);
      for (const value of Object.values(preset.position)) assert.ok(Number.isFinite(value) && Math.abs(value) <= 4);
      for (const entry of Object.values(preset.items)) if (entry) assert.ok(catalog.some(item => item.id === entry.id));
    }
    assert.ok(PRESETS.find(preset => preset.id === "jump").position.y > .5);
    assert.equal(Object.values(PRESETS.find(preset => preset.id === "miner").items).filter(Boolean).length, 1);
    assert.deepEqual(Object.values(PRESETS.find(preset => preset.id === "defender").items).map(item => item?.id), ["netherite_sword", "shield"]);
  });
  const response = await page.goto(baseURL, { waitUntil: "networkidle" }); assert.equal(response?.status(), 200);
  await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: "Редактор поз", exact: true }).click();
  const skin = await page.evaluate(() => localStorage.getItem("minepose-skin"));
  for (const preset of PRESETS) {
    await step(preset.name + ": exact editor transforms, both hands, custom Alex skin, editable rig and uncropped PNG", async () => {
      await button("Открыть позу: " + preset.name).click();
      await expect(page.getByRole("textbox", { name: "Название проекта", exact: true })).toHaveValue(preset.name);
      await ready();
      verifyProject(await projectFile(`${preset.id}.minepose.json`), preset, skin);
      for (const part of Object.keys(preset.pose)) {
        await page.locator("#pe-part-select").selectOption(part);
        const value = preset.pose[part].x, input = page.getByRole("spinbutton", { name: "Угол X в градусах", exact: true });
        await expect(input).toHaveValue(String(value)); await input.fill(String(value + 3)); await input.blur();
        await expect(input).toHaveValue(String(value + 3)); await button("Отменить").click(); await expect(input).toHaveValue(String(value));
      }
      verifyProject(await projectFile(`${preset.id}-after-undo.minepose.json`), preset, skin);
      await page.getByRole("combobox", { name: "Разрешение PNG", exact: true }).selectOption("720");
      await page.getByRole("checkbox", { name: "Без фона", exact: true }).check(); await ready(); await png(preset);
      if (preset.id === "jump") { await button("Сохранить позу").click(); await expect(page.locator(".toast")).toContainText("Поза сохранена"); }
      await button("Вернуться к проектам").click();
      await expect(page.locator(".pl-card")).toHaveCount(12);
    });
  }
  await step("All twelve renders differ and form a visual contact sheet", async () => {
    assert.equal(imageHashes.size, 12);
    const sheet = await page.evaluate(async shots => {
      await document.fonts.ready;
      const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 1110;
      const c = canvas.getContext("2d"); c.fillStyle = "#141118"; c.fillRect(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < shots.length; index++) {
        const x = index % 4 * 320, y = Math.floor(index / 4) * 370;
        c.fillStyle = "#21192d"; c.fillRect(x + 3, y + 3, 314, 364);
        const image = new Image(); image.src = shots[index].url; await image.decode(); c.drawImage(image, x + 10, y + 15, 300, 300);
        c.font = '15px "Golos Text Variable", Arial'; c.textAlign = "center"; c.fillStyle = "#ece3f5"; c.fillText(shots[index].name, x + 160, y + 344);
      }
      return canvas.toDataURL("image/png");
    }, captures);
    await writeFile(path.join(artifacts, "editor-contact-sheet.png"), Buffer.from(sheet.split(",")[1], "base64"));
  });
  const jump = PRESETS.find(preset => preset.id === "jump"), defender = PRESETS.find(preset => preset.id === "defender");
  await step("Jump model placement survives saving, reload and JSON import", async () => {
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: /^Мои проекты/ }).click();
    await button("Открыть " + jump.name).click(); await ready();
    verifyProject(await projectFile("jump-reloaded.minepose.json"), jump, skin);
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
    try {
      const imported = await isolated.newPage(); imported.setDefaultTimeout(30_000); await imported.goto(baseURL, { waitUntil: "networkidle" });
      await imported.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name: /^Мои проекты/ }).click();
      const chooser = imported.waitForEvent("filechooser"); await button("Импорт JSON", imported).click(); await (await chooser).setFiles(path.join(artifacts, "jump-reloaded.minepose.json"));
      await ready(imported); verifyProject(await projectFile("jump-imported.minepose.json", imported), jump, skin);
    } finally { await isolated.close(); }
  });
  await step("Applying another template preserves the skin and is one complete undo step", async () => {
    await page.getByRole("combobox", { name: "Готовая поза", exact: true }).selectOption(defender.id);
    await button("Применить шаблон").click(); await ready();
    verifyProject(await projectFile("jump-applied-defender.minepose.json"), defender, skin);
    await button("Отменить").click(); await ready(); verifyProject(await projectFile("jump-template-undone.minepose.json"), jump, skin);
    await button("Повторить").click(); await ready(); verifyProject(await projectFile("jump-template-redone.minepose.json"), defender, skin);
  });
  await step("No browser runtime or console errors", async () => { assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []); });
  await writeFile(path.join(artifacts, "editor-report.json"), JSON.stringify({ baseURL, passed: true, checks, errors, consoleErrors, captures: captures.map(({ url, ...value }) => value) }, null, 2));
  console.log(`\nAll ${checks.length} preset editor checks passed. Artifacts: ${artifacts}`);
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, "editor-failure.png"), fullPage: true }).catch(() => {});
  await writeFile(path.join(artifacts, "editor-report.json"), JSON.stringify({ baseURL, passed: false, checks, errors, consoleErrors, captures: captures.map(({ url, ...value }) => value), error: error.stack || String(error) }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); }
