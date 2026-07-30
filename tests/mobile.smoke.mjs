/* Touch-device smoke test. See tests/harness.mjs for how to run it.

   Every other suite runs in a desktop context, which reports `hover: hover` no
   matter how narrow you make the viewport. Three pieces of CSS are therefore
   unreachable from them, and all three are the *only* way to do something on a
   phone:

     .tile .move        the ← → reorder buttons — drag doesn't exist on touch
     .tile .remove      the ✕, which otherwise only appears on hover
     .tile-controls     rotate's ↺ ↻ overlay, same problem

   Plus the panel, which stops being a sidebar under 900px and becomes a fixed
   bottom sheet. `isMobile`/`hasTouch` is what flips Chromium to hover:none and
   pointer:coarse, so this suite asserts that first — without it the rest would
   pass against desktop CSS and prove nothing. */
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";

const { check, report } = suite("mobile");
const { browser, page, errors } = await launch({
  viewport: { width: 390, height: 844 },   // iPhone 14-ish
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
});

const names = () => page.evaluate(() =>
  [...document.querySelectorAll(".card .name")].map(n => n.textContent).join(","));

// --- 1. the emulation is what we think it is -------------------------------
await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });
const media = await page.evaluate(() => ({
  hover: matchMedia("(hover: none)").matches,
  coarse: matchMedia("(pointer: coarse)").matches,
  narrow: matchMedia("(max-width: 900px)").matches
}));
check("the context really is hover:none", media.hover, JSON.stringify(media));
check("and pointer:coarse", media.coarse);
check("and under the 900px breakpoint", media.narrow);

// --- 2. the panel becomes a bottom sheet -----------------------------------
await page.setInputFiles("#fileInput",
  [`${FIX}/alpha.pdf`, `${FIX}/beta.pdf`, `${FIX}/gamma.pdf`]);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".card").length === 3);

const panel = await page.evaluate(() => {
  const el = document.querySelector(".panel");
  const r = el.getBoundingClientRect();
  return { position: getComputedStyle(el).position,
           pinned: Math.abs(r.bottom - innerHeight) < 2,
           overlapsGrid: r.top < document.querySelector(".card").getBoundingClientRect().bottom };
});
check("the panel is a fixed bottom sheet", panel.position === "fixed", JSON.stringify(panel));
check("pinned to the bottom of the viewport", panel.pinned, JSON.stringify(panel));
check("the action button is reachable", await page.locator(".btn-action").isVisible());

const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 390px", overflow <= 0, "overflow " + overflow + "px");

// --- 3. the touch-only controls exist --------------------------------------
const first = page.locator(".card").first();
check("the ← → reorder buttons are shown", await first.locator(".move").isVisible());
check("the remove ✕ is shown without hover", await first.locator(".remove").isVisible());

// --- 4. and they actually work by tap --------------------------------------
check("initial order", (await names()) === "alpha.pdf,beta.pdf,gamma.pdf", await names());
await first.locator('[data-action="right"]').tap();
await page.waitForTimeout(400);
check("tapping → moves the card along",
  (await names()) === "beta.pdf,alpha.pdf,gamma.pdf", await names());
await page.locator(".card").nth(1).locator('[data-action="left"]').tap();
await page.waitForTimeout(400);
check("tapping ← moves it back",
  (await names()) === "alpha.pdf,beta.pdf,gamma.pdf", await names());

// Removing is hover-gated too, so it is only reachable here.
await page.locator(".card").first().locator(".remove").tap();
await page.waitForTimeout(400);
check("tapping ✕ removes a card",
  (await names()) === "beta.pdf,gamma.pdf", await names());

// --- 5. a tool completes end to end by tap ---------------------------------
await page.locator(".btn-action").tap();
await page.waitForSelector("#done.on", { timeout: 90000 });
check("merge completes on a touch device", await page.locator("#done.on").isVisible());
await page.screenshot({ path: path.join(TMP, "mobile-merge-390.png") });

// --- 6. the page-tile overlay controls, on a different tool ----------------
/* rotate uses .tile-controls, which is a separate hover:none rule from merge's
   .move — a fix to one has never implied the other. */
await page.goto(BASE + "/rotate.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/gamma.pdf`);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".page-tile canvas").length > 0,
  null, { timeout: 20000 });

const tile = page.locator('.page-tile[data-index="0"]');
check("rotate's ↺ ↻ overlay is shown without hover",
  await tile.locator(".tile-controls").isVisible());

const angleOf = () => page.evaluate(() => {
  const c = document.querySelector('.page-tile[data-index="0"] canvas');
  return c ? c.style.transform : "";
});
check("the page starts unrotated", !(await angleOf()).includes("rotate("), await angleOf());
await tile.locator('[data-action="right"]').tap();
await page.waitForTimeout(500);
check("tapping ↻ turns the page", (await angleOf()).includes("rotate(90deg)"), await angleOf());

await page.screenshot({ path: path.join(TMP, "mobile-rotate-390.png") });

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
