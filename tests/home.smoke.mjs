/* Landing page + shared chrome smoke test. See tests/harness.mjs for how to run it. */
import path from "node:path";
import { launch, suite, BASE, TMP } from "./harness.mjs";

const { check, report } = suite("home");
const { browser, page, errors } = await launch();

await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });

// --- injected chrome -------------------------------------------------------
check("header is injected", (await page.locator(".site-header .logo").count()) === 1);
check("footer is injected", (await page.locator(".site-footer .privacy").count()) === 1);
check("footer states files stay local",
  (await page.locator(".site-footer .privacy").textContent()).includes("stay on your device"));
check("header stays 64px tall", await page.evaluate(() =>
  document.querySelector(".site-header").getBoundingClientRect().height) === 64);
check("header is sticky", await page.evaluate(() =>
  getComputedStyle(document.querySelector(".site-header")).position) === "sticky");
check("logo goes home", (await page.locator('.site-header a.logo[href="index.html"]').count()) === 1);
check("'All tools' is the active nav item here",
  (await page.locator(".nav a.active").textContent()) === "All tools");

// --- tool grid -------------------------------------------------------------
const cards = page.locator(".tool-card");
check("every tool has a card", (await cards.count()) === 8, (await cards.count()) + " cards");
check("every card has an icon", (await page.locator(".tool-card .icon svg").count()) === 8);
check("every card has a blurb", (await page.locator(".tool-card p").count()) === 8);

const ready = page.locator(".tool-card:not(.soon)");
check("merge is the only ready tool", (await ready.count()) === 1);
check("ready tool links to its page",
  (await ready.first().getAttribute("href")) === "merge.html");

const soon = page.locator(".tool-card.soon");
check("unbuilt tools are shown, not hidden", (await soon.count()) === 7);
check("unbuilt tools are visible", await soon.first().isVisible());
check("unbuilt tools carry a Soon badge", (await page.locator(".tool-card.soon .badge").count()) === 7);
check("unbuilt tools are marked disabled",
  (await page.locator('.tool-card.soon[aria-disabled="true"]').count()) === 7);
check("unbuilt tools are not links", (await page.locator("a.tool-card.soon").count()) === 0);
check("unbuilt tools are not keyboard focusable", await page.evaluate(() =>
  [...document.querySelectorAll(".tool-card.soon")].every(c => c.tabIndex < 0)));

check("tool count is honest about progress",
  (await page.locator("#toolCount").textContent()).includes("1 of 8"),
  await page.locator("#toolCount").textContent());

// No tool may be advertised that pdf-lib cannot actually deliver.
const names = (await page.locator(".tool-card h3").allTextContents()).join(" ").toLowerCase();
check("no compress/encrypt/office tools are advertised",
  !/compress|password|protect|encrypt|word|excel|powerpoint/.test(names), names);

// --- footer links match the registry ---------------------------------------
check("footer lists all 8 tools", (await page.locator(".footer-tools > *").count()) === 8);
check("footer links only to built tools", (await page.locator(".footer-tools a").count()) === 1);

// --- navigation actually works ---------------------------------------------
await page.locator('.tool-card[href="merge.html"]').click();
await page.waitForURL("**/merge.html");
check("clicking a tool card opens the tool", page.url().endsWith("merge.html"));
check("nav marks the current tool active",
  (await page.locator(".nav a.active").textContent()) === "Merge PDF");
check("current tool has aria-current", (await page.locator('.nav a[aria-current="page"]').count()) === 1);
await page.locator(".site-header .logo").click();
await page.waitForURL("**/index.html");
check("logo returns to the directory", page.url().endsWith("index.html"));

// --- responsive ------------------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("cards go single-column at 375px", await page.evaluate(() => {
  const [a, b] = document.querySelectorAll(".tool-card");
  return a.getBoundingClientRect().top !== b.getBoundingClientRect().top;
}));
await page.screenshot({ path: path.join(TMP, "home-375.png"), fullPage: true });

// --- footer sits at the bottom of a short page -----------------------------
await page.setViewportSize({ width: 1280, height: 1400 });
await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });
check("footer is pinned to the bottom on a short page", await page.evaluate(() => {
  const f = document.querySelector(".site-footer").getBoundingClientRect();
  return Math.abs(f.bottom - window.innerHeight) < 2;
}));

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
