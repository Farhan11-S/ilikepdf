/* Rotate PDF smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";

const { check, report } = suite("rotate");
const { browser, page, errors } = await launch();

/* pdf.js exposes each page's effective rotation, which is what we actually
   care about — not whether some bytes changed. */
async function rotationsOf(bytes){
  return page.evaluate(async arr => {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const out = [];
    for(let i = 1; i <= doc.numPages; i++) out.push((await doc.getPage(i)).rotate);
    return out;
  }, [...bytes]);
}

async function load(name, pages){
  await page.goto(BASE + "/rotate.html", { waitUntil: "networkidle" });
  await page.setInputFiles("#fileInput", `${FIX}/${name}`);
  await page.waitForSelector("#workspace.on");
  await page.waitForFunction(n => document.querySelectorAll(".page-tile").length === n, pages);
  await page.waitForFunction(n => document.querySelectorAll(".page-tile canvas").length === n,
    pages, { timeout: 15000 });
}

async function download(){
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadBtn").click()
  ]);
  const out = path.join(TMP, dl.suggestedFilename());
  await dl.saveAs(out);
  return { name: dl.suggestedFilename(), bytes: fs.readFileSync(out) };
}

const captions = () => page.locator(".page-tile .page-no").allTextContents();
const transforms = () => page.evaluate(() =>
  [...document.querySelectorAll(".page-tile canvas")].map(c => c.style.transform || "none"));

// --- 1. loading ------------------------------------------------------------
await load("gamma.pdf", 5);          // 5 pages, no existing /Rotate
check("a tile per page", (await page.locator(".page-tile").count()) === 5);
check("filename is shown", (await page.locator("#srcName").textContent()) === "gamma.pdf");
check("nothing is turned yet", (await captions()).join(",") === "1,2,3,4,5");
check("export is disabled until something turns",
  await page.locator(".btn-action").isDisabled());
check("button explains why it's disabled",
  (await page.locator(".btn-action").textContent()) === "Turn a page first");
check("reset is disabled with nothing to reset",
  await page.locator("#resetBtn").isDisabled());

// --- 2. per-page rotation --------------------------------------------------
check("each tile has a left and a right control",
  (await page.locator('.page-tile [data-action="left"]').count()) === 5 &&
  (await page.locator('.page-tile [data-action="right"]').count()) === 5);
check("tile controls are labelled per page",
  (await page.locator('.page-tile [data-action="right"]').first().getAttribute("aria-label"))
    === "Rotate right, page 1");

await page.locator('.page-tile[data-index="1"] [data-action="right"]').click();
check("rotating one page updates its caption", (await captions())[1] === "2 · 90°");
check("other pages are untouched", (await captions()).join(",") === "1,2 · 90°,3,4,5");
check("the turned page is marked", (await page.locator(".page-tile.selected").count()) === 1);
check("export is now enabled", !(await page.locator(".btn-action").isDisabled()));
check("reset is now enabled", !(await page.locator("#resetBtn").isDisabled()));

// --- 3. the thumbnail actually turns ---------------------------------------
let tf = await transforms();
check("the turned thumbnail has a rotate transform", /rotate\(90deg\)/.test(tf[1]), tf[1]);
check("a quarter turn is scaled to fit its box", /scale\(0?\.\d+\)/.test(tf[1]), tf[1]);
check("untouched thumbnails have no transform", tf[0] === "none" && tf[2] === "none");
check("the rotation is animated, not swapped", await page.evaluate(() =>
  getComputedStyle(document.querySelector(".page-tile canvas")).transitionProperty
).then(p => p.includes("transform")));
await page.waitForTimeout(500);   // let the turn finish before measuring
check("the rotated thumbnail still fits its tile", await page.evaluate(() => {
  const tile = document.querySelector('.page-tile[data-index="1"]');
  const c = tile.querySelector("canvas").getBoundingClientRect();
  const b = tile.querySelector(".thumb-box").getBoundingClientRect();
  return c.width <= b.width + 1 && c.height <= b.height + 1;
}));

// --- 4. rotation wraps -----------------------------------------------------
const right = () => page.locator('.page-tile[data-index="1"] [data-action="right"]').click();
await right();
check("two turns right is 180", (await captions())[1] === "2 · 180°");
await right();
check("three turns right is 270", (await captions())[1] === "2 · 270°");
await right();
check("four turns right comes back to 0", (await captions())[1] === "2");
check("a page back at 0 is no longer marked",
  (await page.locator(".page-tile.selected").count()) === 0);
check("export disables again when nothing is turned",
  await page.locator(".btn-action").isDisabled());

await page.locator('.page-tile[data-index="0"] [data-action="left"]').click();
check("turning left from 0 gives 270", (await captions())[0] === "1 · 270°");
check("left transform is applied", /rotate\(270deg\)/.test((await transforms())[0]));

// --- 5. rotate all ---------------------------------------------------------
await load("gamma.pdf", 5);
await page.locator("#allRight").click();
check("rotate all right turns every page",
  (await captions()).join(",") === "1 · 90°,2 · 90°,3 · 90°,4 · 90°,5 · 90°");
check("every thumbnail turned", (await transforms()).every(t => /rotate\(90deg\)/.test(t)));
await page.locator("#allLeft").click();
check("rotate all left undoes it", (await captions()).join(",") === "1,2,3,4,5");
await page.locator("#allLeft").click();
check("rotate all left from 0 gives 270 everywhere",
  (await captions()).every((c, i) => c === `${i + 1} · 270°`));

// rotate-all composes with a per-page turn
await page.locator('.page-tile[data-index="2"] [data-action="right"]').click();
check("a per-page turn stacks on rotate-all", (await captions())[2] === "3");
await page.locator("#resetBtn").click();
check("reset clears every rotation", (await captions()).join(",") === "1,2,3,4,5");
check("reset disables export", await page.locator(".btn-action").isDisabled());

// --- 6. export -------------------------------------------------------------
await page.locator("#allRight").click();
await page.locator('.page-tile[data-index="0"] [data-action="right"]').click();  // page 1 -> 180
await page.locator('.page-tile[data-index="4"] [data-action="left"]').click();   // page 5 -> 0
check("summary counts only the turned pages",
  (await page.locator(".summary").textContent()).replace(/\s+/g, " ").includes("4"),
  (await page.locator(".summary").textContent()).replace(/\s+/g, " "));

await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
let got = await download();
check("output is named after the source", got.name === "gamma_rotated.pdf", got.name);
check("output is a PDF", got.bytes.subarray(0, 5).toString() === "%PDF-");
check("output is non-empty", got.bytes.length > 0, got.bytes.length + " bytes");

await page.goto(BASE + "/rotate.html", { waitUntil: "networkidle" });
let rots = await rotationsOf(got.bytes);
check("every page carries the rotation it was shown at",
  rots.join(",") === "180,90,90,90,0", rots.join(","));

// --- 7. rotation is added to an existing /Rotate ---------------------------
await page.goto(BASE + "/rotate.html", { waitUntil: "networkidle" });
const before = await rotationsOf(fs.readFileSync(`${FIX}/prerotated.pdf`));
check("the fixture really starts rotated", before.join(",") === "90,90", before.join(","));

await load("prerotated.pdf", 2);
await page.locator("#allRight").click();
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
got = await download();
await page.goto(BASE + "/rotate.html", { waitUntil: "networkidle" });
rots = await rotationsOf(got.bytes);
check("a quarter turn adds to the page's existing rotation",
  rots.join(",") === "180,180", rots.join(",") + " (expected 180,180)");

// A full turn should return an already-rotated page to exactly where it began.
await load("prerotated.pdf", 2);
for(let i = 0; i < 4; i++) await page.locator("#allRight").click();
check("four turns is a no-op in the UI", (await captions()).join(",") === "1,2");
check("four turns leaves nothing to export", await page.locator(".btn-action").isDisabled());

// --- 8. rejections and restart ---------------------------------------------
await page.goto(BASE + "/rotate.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-PDF is rejected on the hero",
  (await page.locator("#heroError").textContent()).includes("isn't a PDF")
  && await page.locator("#hero").isVisible());

await load("gamma.pdf", 5);
await page.locator("#allRight").click();
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to the hero", await page.locator("#hero").isVisible());
check("restart clears the grid", (await page.locator(".page-tile").count()) === 0);
await page.setInputFiles("#fileInput", `${FIX}/alpha.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 3);
check("a second document loads after restart", (await page.locator(".page-tile").count()) === 3);
check("rotations reset for the new document", (await captions()).join(",") === "1,2,3");

// --- 9. lazy thumbnails still lazy ----------------------------------------
await page.goto(BASE + "/rotate.html", { waitUntil: "networkidle" });
await page.setViewportSize({ width: 1280, height: 700 });
await page.setInputFiles("#fileInput", `${FIX}/big.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 60);
await page.waitForTimeout(1800);
const rendered = await page.evaluate(() => document.querySelectorAll(".page-tile canvas").length);
check("offscreen pages are not rendered up front", rendered < 60, rendered + "/60");

// A page turned before its thumbnail exists must still come out turned.
await page.locator("#allRight").click();
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(2500);
check("late-rendering thumbnails pick up the rotation", await page.evaluate(() => {
  const canvases = [...document.querySelectorAll(".page-tile canvas")];
  return canvases.length > 0 && canvases.every(c => /rotate\(90deg\)/.test(c.style.transform));
}), "checked " + (await page.evaluate(() => document.querySelectorAll(".page-tile canvas").length)) + " canvases");

// --- 10. responsive --------------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("rotate-all buttons stay reachable at 375px", await page.locator("#allRight").isVisible());
check("the export button stays reachable at 375px", await page.locator(".btn-action").isVisible());
await page.screenshot({ path: path.join(TMP, "rotate-375.png") });

// Keyboard: the per-page controls are hover-revealed, so they must also appear
// on focus or they're unreachable without a mouse.
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(200);
await page.locator('.page-tile[data-index="0"] [data-action="right"]').focus();
await page.waitForTimeout(300);   // the reveal is a transition, not instant
check("hover-revealed controls become visible on keyboard focus", await page.evaluate(() =>
  getComputedStyle(document.querySelector('.page-tile[data-index="0"] .tile-controls')).opacity === "1"));

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
