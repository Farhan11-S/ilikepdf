/* Page numbers smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";

const { check, report } = suite("page-numbers");
const { browser, page, errors } = await launch();

/* Reads a produced PDF back and returns every text item in *display* space —
   the coordinates a reader sees, with the page's own /Rotate already applied.
   That's the only space in which "bottom right" means anything, and it's what
   makes the prerotated fixture a real test rather than a byte comparison. */
async function textItems(bytes){
  return page.evaluate(async arr => {
    const pdfjsLib = await window.ilikepdf.loadPdfJs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const out = [];
    for(let i = 1; i <= doc.numPages; i++){
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });        // includes p.rotate
      const tc = await p.getTextContent();
      out.push({
        w: vp.width, h: vp.height,
        items: tc.items.map(it => {
          const m = pdfjsLib.Util.transform(vp.transform, it.transform);
          // m[1] and m[2] are the off-diagonal terms: zero means the glyphs run
          // straight across the page as displayed, i.e. the text is upright.
          return { str: it.str, x: m[4], y: m[5], skewA: m[1], skewB: m[2] };
        })
      });
    }
    return out;
  }, [...bytes]);
}

async function load(name, pages){
  await page.goto(BASE + "/page-numbers.html", { waitUntil: "networkidle" });
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

const stamps = () => page.locator(".page-tile .stamp").allTextContents();
const runIt = async () => {
  await page.locator(".btn-action").click();
  await page.waitForSelector("#done.on", { timeout: 20000 });
  return download();
};

// --- 1. loading ------------------------------------------------------------
await load("gamma.pdf", 5);
check("a tile per page", (await page.locator(".page-tile").count()) === 5);
check("filename is shown", (await page.locator("#srcName").textContent()) === "gamma.pdf");
check("every page previews a number", (await stamps()).join(",") === "1,2,3,4,5");
check("export is enabled straight away", !(await page.locator(".btn-action").isDisabled()));
check("summary counts the numbered pages",
  (await page.locator(".summary").textContent()).replace(/\s+/g, " ").includes("5"));

// --- 2. the position picker ------------------------------------------------
check("six anchors are offered", (await page.locator("#anchorPick button").count()) === 6);
check("bottom right is selected by default",
  (await page.locator('#anchorPick [aria-checked="true"]').getAttribute("aria-label")) === "Bottom right");

/* The marker must actually move — it is the only feedback for this setting. */
const markerAt = () => page.evaluate(() => {
  const s = document.querySelector('.page-tile[data-index="0"] .stamp').getBoundingClientRect();
  const b = document.querySelector('.page-tile[data-index="0"] .thumb-box').getBoundingClientRect();
  return { fx: (s.left + s.width / 2 - b.left) / b.width, fy: (s.top + s.height / 2 - b.top) / b.height };
});
const br = await markerAt();
check("the default marker sits bottom right", br.fx > 0.5 && br.fy > 0.5, JSON.stringify(br));
await page.locator('#anchorPick [data-anchor="tl"]').click();
const tl = await markerAt();
check("choosing top left moves the marker there", tl.fx < 0.5 && tl.fy < 0.5, JSON.stringify(tl));
check("only one anchor is checked at a time",
  (await page.locator('#anchorPick [aria-checked="true"]').count()) === 1);
await page.locator('#anchorPick [data-anchor="br"]').click();

// --- 3. format and starting number -----------------------------------------
await page.selectOption("#formatSel", "word");
check('"Page 1" format', (await stamps())[0] === "Page 1");
await page.selectOption("#formatSel", "ofn");
check('"1 of 5" format', (await stamps()).join(",") === "1 of 5,2 of 5,3 of 5,4 of 5,5 of 5");
await page.selectOption("#formatSel", "plain");

await page.fill("#startInput", "7");
check("the first page takes the starting number", (await stamps()).join(",") === "7,8,9,10,11");
await page.selectOption("#formatSel", "ofn");
check("'of' counts to the last number, not the page count", (await stamps())[0] === "7 of 11");
await page.selectOption("#formatSel", "plain");
await page.fill("#startInput", "1");

await page.locator("#skipFirst").check();
check("skipping the first page leaves it unmarked", (await stamps()).join(",") === "2,3,4,5");
check("the skipped tile is not marked as included",
  (await page.locator(".page-tile.selected").count()) === 4);
check("summary says 4 of 5",
  (await page.locator(".summary").textContent()).replace(/\s+/g, " ").includes("4 of 5"));
await page.locator("#skipFirst").uncheck();

// --- 4. what actually comes out --------------------------------------------
let got = await runIt();
check("output is named after the source", got.name === "gamma_numbered.pdf", got.name);
check("output is a PDF", got.bytes.subarray(0, 5).toString() === "%PDF-");

await page.goto(BASE + "/page-numbers.html", { waitUntil: "networkidle" });
let read = await textItems(got.bytes);
check("page count is unchanged", read.length === 5, read.length + " pages");
const numbers = read.map(p => p.items.map(i => i.str).filter(s => /^\d+$/.test(s)).join("|"));
check("every page carries its own number", numbers.join(",") === "1,2,3,4,5", numbers.join(","));
check("the original page text survives",
  read[0].items.some(i => i.str.includes("GAMMA - page 1 of 5")));

const spot = read[2].items.find(i => i.str === "3");
check("the number lands bottom right of the page",
  spot.x > read[2].w * 0.7 && spot.y > read[2].h * 0.7,
  `${spot.x.toFixed(0)},${spot.y.toFixed(0)} of ${read[2].w}x${read[2].h}`);
check("the number is inside the page box",
  spot.x < read[2].w && spot.y < read[2].h);

// The margin is in points, so doubling it must move the number inwards.
await load("gamma.pdf", 5);
await page.fill("#marginInput", "120");
got = await runIt();
await page.goto(BASE + "/page-numbers.html", { waitUntil: "networkidle" });
const wide = (await textItems(got.bytes))[2].items.find(i => i.str === "3");
check("a bigger margin pushes the number in from the corner",
  wide.x < spot.x - 80 && wide.y < spot.y - 80,
  `${wide.x.toFixed(0)},${wide.y.toFixed(0)} vs ${spot.x.toFixed(0)},${spot.y.toFixed(0)}`);

// --- 5. pages that carry their own /Rotate ---------------------------------
/* The whole reason js/core/place.js exists. A naive implementation puts this
   number in the opposite corner, lying on its side. */
await load("prerotated.pdf", 2);
got = await runIt();
await page.goto(BASE + "/page-numbers.html", { waitUntil: "networkidle" });
read = await textItems(got.bytes);
check("the fixture really is quarter-turned", read[0].w > read[0].h,
  `${read[0].w}x${read[0].h}`);

const rot = read[0].items.find(i => i.str === "1");
check("a rotated page still gets its number", Boolean(rot));
check("the number lands bottom right as the reader sees it",
  rot && rot.x > read[0].w * 0.7 && rot.y > read[0].h * 0.7,
  rot && `${rot.x.toFixed(0)},${rot.y.toFixed(0)} of ${read[0].w}x${read[0].h}`);
check("the number reads upright, not sideways",
  rot && Math.abs(rot.skewA) < 0.01 && Math.abs(rot.skewB) < 0.01,
  rot && `skew ${rot.skewA.toFixed(3)},${rot.skewB.toFixed(3)}`);

// --- 6. rejections, edges and restart --------------------------------------
await page.goto(BASE + "/page-numbers.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-PDF is rejected on the hero",
  (await page.locator("#heroError").textContent()).includes("isn't a PDF")
  && await page.locator("#hero").isVisible());

await load("onepage.pdf", 1);
await page.locator("#skipFirst").check();
check("skipping the only page disables export",
  await page.locator(".btn-action").isDisabled());
check("the button says why it's disabled",
  (await page.locator(".btn-action").textContent()) === "Nothing left to number");
await page.locator("#skipFirst").uncheck();

await runIt();
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to the hero", await page.locator("#hero").isVisible());
check("restart clears the grid", (await page.locator(".page-tile").count()) === 0);
await page.setInputFiles("#fileInput", `${FIX}/alpha.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 3);
check("a second document loads after restart", (await stamps()).join(",") === "1,2,3");

// --- 7. lazy thumbnails still lazy, and markers survive late renders --------
await page.goto(BASE + "/page-numbers.html", { waitUntil: "networkidle" });
await page.setViewportSize({ width: 1280, height: 700 });
await page.setInputFiles("#fileInput", `${FIX}/big.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 60);
await page.waitForTimeout(1800);
check("offscreen pages are not rendered up front",
  (await page.evaluate(() => document.querySelectorAll(".page-tile canvas").length)) < 60);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(2500);
/* A thumbnail arriving late replaces everything inside .thumb-box, so a marker
   built once at tile construction would vanish exactly here. */
check("markers survive a late-arriving thumbnail", await page.evaluate(() =>
  [...document.querySelectorAll(".page-tile")].filter(t => t.querySelector("canvas"))
    .every(t => t.querySelector(".stamp"))));

// --- 8. responsive ---------------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("the position picker stays reachable at 375px",
  await page.locator("#anchorPick").isVisible());
check("the export button stays reachable at 375px", await page.locator(".btn-action").isVisible());
await page.screenshot({ path: path.join(TMP, "page-numbers-375.png") });

// --- a signed PDF ----------------------------------------------------------
await page.goto(BASE + "/page-numbers.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/signed.pdf`);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 2);
const pnSig = (await page.locator(".panel .error").textContent()).trim();
check("a signed PDF is called out", /digitally signed/i.test(pnSig), JSON.stringify(pnSig));
check("and is not accused of having form fields", !/form fields/i.test(pnSig));
check("the warning doesn't block numbering", !(await page.locator(".btn-action").isDisabled()));

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
