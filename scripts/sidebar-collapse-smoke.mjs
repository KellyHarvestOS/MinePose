import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const artifacts = path.resolve("artifacts/sidebar-collapse");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1660, height: 1080 }, reducedMotion: "reduce", locale: "ru-RU" });
page.setDefaultTimeout(30000); expect.configure({ timeout: 20000 });
const checks = [], errors = [], consoleErrors = [], metrics = {};
page.on("pageerror", error => errors.push(error.stack || error.message));
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
const btn = name => page.getByRole("button", { name, exact: true });
const navigation = () => page.getByRole("navigation", { name: "Главное меню" });
const nav = name => navigation().getByRole("button", { name, exact: true });
const sidebar = () => page.locator(".sidebar");
async function step(name, run) { await run(); checks.push(name); console.log("PASS " + name); }
async function bounds(selector) { return page.locator(selector).evaluate(element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; }); }
async function noOverflow(label) { const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(size.scroll <= size.width + 1, `${label}: ${JSON.stringify(size)}`); }
async function collapsedLayout() { await expect.poll(async () => Math.round((await bounds(".sidebar")).width)).toBe(70); await expect.poll(async () => Math.round((await bounds(".main-shell")).x)).toBe(70); await expect(page.locator(".topbar")).toBeHidden(); await noOverflow("collapsed desktop"); }
async function editorReady() { await expect(page.locator(".av-viewport")).toHaveAttribute("data-ready", "true"); }

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await step("Collapsing the sidebar exposes an icon rail and frees the global header", async () => {
    await expect(btn("Свернуть меню")).toBeVisible();
    const expandedSidebar = await bounds(".sidebar"), expandedHeader = await bounds(".topbar");
    assert.equal(Math.round(expandedSidebar.width), 238); assert.equal(Math.round(expandedHeader.height), 76);
    await btn("Свернуть меню").click(); await collapsedLayout();
    await expect(btn("Развернуть меню")).toBeVisible();
    for (const name of ["Главное", "Редактор поз", "Анимации", "Инструменты", "Мои проекты"]) {
      await expect(nav(name)).toBeVisible(); assert.equal(await nav(name).getAttribute("title"), name);
      const label = nav(name).locator("span").first(); await expect(label).toBeHidden();
    }
    metrics.expandedSidebar = expandedSidebar; metrics.expandedHeader = expandedHeader; metrics.collapsedSidebar = await bounds(".sidebar");
  });
  await step("The animation editor receives both the additional width and full viewport height", async () => {
    await nav("Анимации").click(); await btn("Создать анимацию: Пустой проект").click(); await editorReady();
    await expect.poll(async () => Math.round((await bounds(".as-studio")).y)).toBe(0);
    await expect.poll(async () => Math.round((await bounds(".as-studio")).height)).toBe(1080);
    const studio = await bounds(".as-studio"); assert.equal(Math.round(studio.x), 70); assert.equal(Math.round(studio.width), 1590);
    metrics.studio = studio;
    await page.screenshot({ path: path.join(artifacts, "collapsed-animation.png"), fullPage: true });
  });
  await step("The collapsed tools menu remains usable through an unclipped flyout", async () => {
    await nav("Инструменты").click(); await expect(nav("Инструменты")).toHaveAttribute("aria-expanded", "true");
    const heading = btn("Генератор заголовков"); await expect(heading).toBeVisible();
    const rectangle = await heading.boundingBox(); assert.ok(rectangle.x >= 70 && rectangle.x + rectangle.width <= 1660, JSON.stringify(rectangle));
    await page.screenshot({ path: path.join(artifacts, "tools-flyout.png"), fullPage: true });
    await heading.click(); await expect(page.locator(".as-studio")).toHaveCount(0);
    await collapsedLayout();
  });
  await step("The preference survives reload and expanding restores the original editor layout", async () => {
    await page.reload({ waitUntil: "networkidle" }); await collapsedLayout();
    await nav("Анимации").click(); await page.locator(".apl-card-open").first().click(); await editorReady();
    await expect.poll(async () => Math.round((await bounds(".as-studio")).y)).toBe(0);
    await btn("Развернуть меню").click(); await expect(page.locator(".topbar")).toBeVisible();
    await expect.poll(async () => Math.round((await bounds(".sidebar")).width)).toBe(238);
    await expect.poll(async () => Math.round((await bounds(".as-studio")).y)).toBe(76);
    await expect.poll(async () => Math.round((await bounds(".as-studio")).height)).toBe(1004);
    await expect(btn("Свернуть меню")).toBeVisible();
    await btn("Свернуть меню").click();
  });
  await step("Tablet and mobile preserve navigation and never lose the menu opener", async () => {
    for (const width of [1024, 768]) { await page.setViewportSize({ width, height: 900 }); await collapsedLayout(); await expect.poll(async () => Math.round((await bounds(".as-studio")).y)).toBe(0); await noOverflow(String(width)); }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await expect(btn("Открыть меню")).toBeVisible(); await expect(page.locator(".topbar")).toBeVisible();
      await expect.poll(async () => Math.round((await bounds(".main-shell")).x)).toBe(0);
      await btn("Открыть меню").click(); await expect(sidebar()).toHaveClass(/is-open/);
      await expect.poll(async () => Math.round((await bounds(".sidebar")).width)).toBe(238);
      await expect(nav("Главное").locator("span").first()).toBeVisible();
      await page.screenshot({ path: path.join(artifacts, `mobile-${width}.png`), fullPage: true });
      await nav("Главное").click(); await expect(sidebar()).not.toHaveClass(/is-open/); await noOverflow(String(width));
    }
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
  });
} finally {
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ checks, metrics, errors, consoleErrors }, null, 2));
  await browser.close();
}
