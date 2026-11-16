import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts/animation-project-actions");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1540, height: 1040 }, locale: "ru-RU", deviceScaleFactor: 1 });
const page = await context.newPage(); page.setDefaultTimeout(30000); expect.configure({ timeout: 20000 });
const checks = [], errors = [], consoleErrors = [];
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const btn = (name, scope = page) => scope.getByRole("button", { name, exact: true });
const nav = name => page.getByRole("navigation", { name: "Главное меню" }).getByRole("button", { name, exact: true });
const card = name => page.locator(".apl-card").filter({ has: btn(`Открыть анимацию ${name}`) });
const pick = name => page.getByRole("checkbox", { name: `Выбрать анимацию ${name}`, exact: true });
const remove = name => btn(`Удалить анимацию: ${name}`);
const all = () => page.getByRole("checkbox", { name: "Выбрать все анимации", exact: true });
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function database(action, value) {
  return page.evaluate(({ action, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open("minepose-animation-studio-v1", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(["projects", "meta"], action === "seed" ? "readwrite" : "readonly"), projects = tx.objectStore("projects"), meta = tx.objectStore("meta");
      let data = {};
      if (action === "seed") { projects.clear(); meta.clear(); for (const project of value) projects.put(project); meta.put({ id: "draft", project: value.at(-1) }); }
      else { const a = projects.getAll(), b = meta.get("draft"); a.onsuccess = () => { data.projects = a.result; }; b.onsuccess = () => { data.draft = b.result?.project || null; }; }
      tx.oncomplete = () => { db.close(); resolve(data); }; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    };
  }), { action, value });
}
async function ready() { await expect(page.locator(".av-viewport canvas")).toBeVisible(); await expect(page.locator(".av-status")).toHaveCount(0); await expect(page.locator(".as-save-state")).toHaveText("Сохранено"); }
async function confirmDeletion() { await page.getByRole("dialog").getByRole("button", { name: /^Удалить(?: \d+)?$/ }).click(); await expect(page.getByRole("dialog")).toHaveCount(0); }

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await nav("Анимации").click(); await btn("Создать анимацию: Пустой проект").click(); await ready();
  const base = (await database("read")).draft; assert.equal(base.kind, "animation");
  await nav("Главное").click();
  const names = ["Сохранить один", "Выбор два", "Выбор три"];
  const projects = names.map((name, index) => ({ ...structuredClone(base), id: `actions-project-${index}`, name, updatedAt: Date.now() - index * 1000 }));
  await database("seed", projects); await page.reload({ waitUntil: "networkidle" }); await nav("Мои проекты").click();
  await step("Every animation card has a separate top-right quick delete and checkbox", async () => {
    await expect(page.locator(".apl-card")).toHaveCount(3);
    for (const name of names) {
      await expect(remove(name)).toBeVisible(); await expect(pick(name)).toBeVisible();
      const a = await card(name).boundingBox(), b = await remove(name).boundingBox();
      assert.ok(b.x > a.x + a.width * .7 && b.y < a.y + 45, "Delete button must be in the top-right corner");
    }
    await remove(names[0]).click(); await expect(page.getByRole("dialog")).toContainText(names[0]);
    await btn("Отмена", page.getByRole("dialog")).click(); await expect(page.locator(".apl-card")).toHaveCount(3);
    assert.equal((await database("read")).projects.length, 3);
    await page.screenshot({ path: path.join(artifacts, "cards-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 900 });
    const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width + 1);
    await expect(remove(names[0])).toBeVisible(); await expect(pick(names[0])).toBeVisible();
    await page.screenshot({ path: path.join(artifacts, "cards-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1540, height: 1040 });
  });
  await step("Checkboxes select cards without opening them and select-all shows partial state", async () => {
    await pick(names[0]).check(); await expect(page.locator(".as-studio")).toHaveCount(0);
    assert.equal(await all().evaluate(element => element.indeterminate), true);
    await all().check(); for (const name of names) await expect(pick(name)).toBeChecked();
    await all().uncheck(); for (const name of names) await expect(pick(name)).not.toBeChecked();
    await expect(btn("Удалить выбранные анимации")).toHaveCount(0);
  });
  await step("Filtered bulk deletion removes only selected projects and their matching draft atomically", async () => {
    await page.getByRole("textbox", { name: "Поиск проектов", exact: true }).fill("Выбор");
    await expect(page.locator(".apl-card")).toHaveCount(2); await all().check();
    await btn("Удалить выбранные анимации").click(); await expect(page.getByRole("dialog")).toContainText("2");
    await confirmDeletion(); const data = await database("read");
    assert.deepEqual(data.projects.map(project => project.id), [projects[0].id]); assert.equal(data.draft, null);
    await page.getByRole("textbox", { name: "Поиск проектов", exact: true }).fill(""); await expect(card(names[0])).toBeVisible(); await expect(page.locator(".apl-card")).toHaveCount(1);
    await page.reload({ waitUntil: "networkidle" }); await nav("Мои проекты").click(); await expect(page.locator(".apl-card")).toHaveCount(1);
    assert.equal((await database("read")).projects.length, 1);
  });
  await step("Quick deletion persists after reload and leaves a usable empty list", async () => {
    await remove(names[0]).click(); await confirmDeletion(); await expect(page.locator(".apl-card")).toHaveCount(0);
    assert.equal((await database("read")).projects.length, 0);
    await page.reload({ waitUntil: "networkidle" }); await nav("Мои проекты").click(); await expect(page.locator(".apl-card")).toHaveCount(0);
  });
  await step("Deleting the current draft in the studio lobby cannot resurrect it on unmount", async () => {
    await nav("Анимации").click(); await btn("Создать анимацию: Пустой проект").click(); await ready();
    const name = "Удалённый текущий черновик";
    await page.getByRole("textbox", { name: "Название анимации", exact: true }).fill(name); await page.getByRole("textbox", { name: "Название анимации", exact: true }).blur();
    await expect(page.locator(".as-save-state")).toHaveText("Сохранено");
    const id = (await database("read")).draft.id;
    await btn("К проектам анимации").click(); await remove(name).click(); await confirmDeletion();
    await expect(page.locator(".apl-card")).toHaveCount(0); let data = await database("read"); assert.equal(data.draft, null); assert.ok(!data.projects.some(project => project.id === id));
    await nav("Главное").click(); await page.reload({ waitUntil: "networkidle" }); await nav("Мои проекты").click();
    data = await database("read"); assert.ok(!data.projects.some(project => project.id === id)); assert.equal(data.draft, null); await expect(page.locator(".apl-card")).toHaveCount(0);
  });
  await page.screenshot({ path: path.join(artifacts, "empty-after-deletion.png"), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
} finally {
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ checks, errors, consoleErrors }, null, 2));
  await browser.close();
}
