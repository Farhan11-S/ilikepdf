/* Organize pages smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";

const { check, report } = suite("organize");
const { browser, page, errors } = await launch();

/* The page text of every page of a produced PDF, in order — which is the only
   way to prove the working set's order actually reached the output. */
async function textOf(bytes){
  return page.evaluate(async arr => {
    const pdfjsLib = await window.ilikepdf.loadPdfJs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const out = [];
    for(let i = 1; i <= doc.numPages; i++){
      const t = await (await doc.getPage(i)).getTextContent();
      out.push(t.items.map(x => x.str).join(""));
    }
    return out;
  }, [...bytes]);
}

async function load(names, tiles){
  await page.goto(BASE + "/organize.html", { waitUntil: "networkidle" });
  await page.setInputFiles("#fileInput", names.map(n => `${FIX}/${n}`));
  await page.waitForSelector("#workspace.on");
  await page.waitForFunction(n => document.querySelectorAll(".page-tile").length === n, tiles);
  await page.waitForFunction(n => document.querySelectorAll(".page-tile canvas").length === n,
    tiles, { timeout: 15000 });
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

const orders   = () => page.locator(".page-tile .order").allTextContents();
const captions = () => page.locator(".page-tile .page-no").allTextContents();
const tags = () => page.evaluate(() =>
  [...document.querySelectorAll(".page-tile .mark")].map(m => m.textContent).join(","));

/* Drag tile `from` onto the far side of tile `to`, through the real handlers. */
async function drag(from, to){
  await page.evaluate(([f, t]) => {
    const tiles = [...document.querySelectorAll(".page-tile")];
    const dt = new DataTransfer();
    tiles[f].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const r = tiles[t].getBoundingClientRect();
    tiles[t].dispatchEvent(new DragEvent("dragover", {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: r.left + r.width * (t > f ? 0.9 : 0.1), clientY: r.top + r.height / 2
    }));
    document.querySelector(".page-tile").dispatchEvent(new DragEvent("dragend", { bubbles: true }));
  }, [from, to]);
  await page.waitForTimeout(150);
}

// --- 1. several PDFs become one working set --------------------------------
await load(["alpha.pdf", "beta.pdf"], 5);          // 3 pages + 2 pages
check("pages from every file are gathered", (await page.locator(".page-tile").count()) === 5);
check("order badges number the output", (await orders()).join(",") === "1,2,3,4,5");
check("captions show the page within its source", (await captions()).join(",") === "1,2,3,1,2");
check("tiles are tagged with their source file", (await tags()) === "1,1,1,2,2");
check("a legend explains the source tags", (await page.locator(".legend-item").count()) === 2);
check("the legend names the files",
  (await page.locator(".legend").textContent()).includes("alpha.pdf") &&
  (await page.locator(".legend").textContent()).includes("beta.pdf"));
check("header counts the files", (await page.locator("#srcName").textContent()) === "2 files");
check("header counts the pages", (await page.locator("#srcMeta").textContent()).includes("5 pages"));
check("export is enabled", !(await page.locator(".btn-action").isDisabled()));
check("undo starts disabled", await page.locator("#undoBtn").isDisabled());
check("tiles are draggable", await page.evaluate(() =>
  document.querySelector(".page-tile").draggable === true));
check("an add-more button is offered", (await page.locator(".add-card").count()) === 1);
// Touch devices get no HTML5 drag, so the arrow fallback must exist for them.
check("every tile has arrow controls for touch",
  (await page.locator('.page-tile [data-action="left"]').count()) === 5 &&
  (await page.locator('.page-tile [data-action="right"]').count()) === 5);
await page.evaluate(() => document.querySelectorAll(".page-tile")[0].querySelector('[data-action="right"]').click());
check("the arrow fallback reorders", (await captions()).join(",") === "2,1,3,1,2");
check("the arrow fallback is undoable", !(await page.locator("#undoBtn").isDisabled()));
await page.locator("#undoBtn").click();
check("undo reverses an arrow move", (await captions()).join(",") === "1,2,3,1,2");
await page.evaluate(() => document.querySelectorAll(".page-tile")[0].querySelector('[data-action="left"]').click());
check("moving left off the start does nothing", (await captions()).join(",") === "1,2,3,1,2");
check("a no-op move isn't pushed onto the undo stack",
  await page.locator("#undoBtn").isDisabled());

// --- 2. drag to reorder ----------------------------------------------------
await drag(0, 4);
check("drag moves a page to the end", (await captions()).join(",") === "2,3,1,2,1");
check("order badges renumber after a drag", (await orders()).join(",") === "1,2,3,4,5");
check("the moved page keeps its source tag", (await tags()) === "1,1,2,2,1");
check("dragging enables undo", !(await page.locator("#undoBtn").isDisabled()));
check("no tile is left mid-drag", (await page.locator(".page-tile.dragging").count()) === 0);

await page.locator("#undoBtn").click();
check("undo restores the previous order", (await captions()).join(",") === "1,2,3,1,2");
check("undo empties back to disabled", await page.locator("#undoBtn").isDisabled());

// One undo per drag, not one per intermediate position the pointer crossed.
await drag(0, 4);
await page.locator("#undoBtn").click();
check("a whole drag is a single undo step", (await captions()).join(",") === "1,2,3,1,2");

// --- 3. delete and undo ----------------------------------------------------
await page.evaluate(() => document.querySelectorAll(".page-tile")[1].querySelector(".remove").click());
check("remove drops a page", (await page.locator(".page-tile").count()) === 4);
check("the right page went", (await captions()).join(",") === "1,3,1,2");
check("summary counts what was removed",
  (await page.locator(".summary").textContent()).replace(/\s+/g, " ").includes("removed"),
  (await page.locator(".summary").textContent()).replace(/\s+/g, " "));
await page.locator("#undoBtn").click();
check("undo brings a deleted page back", (await page.locator(".page-tile").count()) === 5);
check("the restored page is back in position", (await captions()).join(",") === "1,2,3,1,2");

// Several steps deep.
await page.evaluate(() => document.querySelectorAll(".page-tile")[0].querySelector(".remove").click());
await page.evaluate(() => document.querySelectorAll(".page-tile")[0].querySelector(".remove").click());
await drag(0, 2);
check("three changes leave three pages", (await page.locator(".page-tile").count()) === 3);
await page.locator("#undoBtn").click();
await page.locator("#undoBtn").click();
await page.locator("#undoBtn").click();
check("undo unwinds every step", (await captions()).join(",") === "1,2,3,1,2");
check("undo stops when there's nothing left", await page.locator("#undoBtn").isDisabled());

// --- 4. reset --------------------------------------------------------------
await page.evaluate(() => document.querySelectorAll(".page-tile")[0].querySelector(".remove").click());
await drag(0, 3);
await page.locator("#resetBtn").click();
check("reset restores every page in source order", (await captions()).join(",") === "1,2,3,1,2");
check("reset is itself undoable", !(await page.locator("#undoBtn").isDisabled()));

// --- 5. deleting everything ------------------------------------------------
for(let i = 0; i < 5; i++){
  await page.evaluate(() => document.querySelectorAll(".page-tile")[0].querySelector(".remove").click());
}
check("every page can be removed", (await page.locator(".page-tile").count()) === 0);
check("an empty set can't be exported", await page.locator(".btn-action").isDisabled());
check("the empty state says what to do",
  (await page.locator(".btn-action").textContent()) === "Keep at least one page");
await page.locator("#resetBtn").click();
check("reset recovers from empty", (await page.locator(".page-tile").count()) === 5);

// --- 6. export honours the working set -------------------------------------
await load(["alpha.pdf", "beta.pdf"], 5);
// Drop alpha p2, then pull beta p1 to the front, leaving the two sources
// interleaved: beta1, alpha1, alpha3, beta2. Pages have to be copied per source
// but emitted in working-set order, so this is the case that catches a mix-up.
await page.evaluate(() => document.querySelectorAll(".page-tile")[1].querySelector(".remove").click());
await drag(2, 0);
check("working set interleaves the two sources",
  (await captions()).join(",") === "1,1,3,2", (await captions()).join(","));
check("tags follow the pages", (await tags()) === "2,1,1,2", await tags());

await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
let got = await download();
check("output is a PDF", got.bytes.subarray(0, 5).toString() === "%PDF-");
check("output is named for a multi-file set", got.name === "ilikepdf_organized.pdf", got.name);
check("done screen reports the page count",
  (await page.locator("#doneMeta").textContent()).includes("4 pages"),
  await page.locator("#doneMeta").textContent());

await page.goto(BASE + "/organize.html", { waitUntil: "networkidle" });
let text = await textOf(got.bytes);
check("output has exactly the kept pages", text.length === 4, "got " + text.length);
check("output is in the working set's order, across both files",
  text[0].includes("BETA - page 1") && text[1].includes("ALPHA - page 1") &&
  text[2].includes("ALPHA - page 3") && text[3].includes("BETA - page 2"),
  JSON.stringify(text));

// --- 7. a single source ----------------------------------------------------
await load(["gamma.pdf"], 5);
check("one file needs no source tags", (await tags()) === ",,,,");
check("one file needs no legend", (await page.locator(".legend-item").count()) === 0);
check("header names the single file", (await page.locator("#srcName").textContent()) === "gamma.pdf");
await drag(4, 0);
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
got = await download();
check("single-source output is named after it", got.name === "gamma_organized.pdf", got.name);
await page.goto(BASE + "/organize.html", { waitUntil: "networkidle" });
text = await textOf(got.bytes);
check("the moved page leads the output", text[0].includes("GAMMA - page 5"), text[0]);

// --- 8. adding more files later --------------------------------------------
await load(["alpha.pdf"], 3);
check("one source to start", (await page.locator(".legend-item").count()) === 0);
await page.setInputFiles("#fileInput", `${FIX}/beta.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 5);
check("added pages join the set", (await page.locator(".page-tile").count()) === 5);
check("tags appear once there's a second source", (await tags()) === "1,1,1,2,2");
check("the legend grows", (await page.locator(".legend-item").count()) === 2);
check("adding is undoable", !(await page.locator("#undoBtn").isDisabled()));
await page.locator("#undoBtn").click();
check("undo removes the added pages", (await page.locator(".page-tile").count()) === 3);

// --- 9. rejections and restart ---------------------------------------------
await page.goto(BASE + "/organize.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-PDF is rejected on the hero",
  (await page.locator("#heroError").textContent()).includes("aren't PDFs")
  && await page.locator("#hero").isVisible());

await load(["alpha.pdf"], 3);
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to the hero", await page.locator("#hero").isVisible());
check("restart clears the grid", (await page.locator(".page-tile").count()) === 0);
await page.setInputFiles("#fileInput", `${FIX}/beta.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 2);
check("a fresh set loads after restart", (await page.locator(".page-tile").count()) === 2);
check("history is cleared by restart", await page.locator("#undoBtn").isDisabled());

// --- 10. lazy thumbnails, and reordering doesn't re-render -----------------
await page.goto(BASE + "/organize.html", { waitUntil: "networkidle" });
await page.setViewportSize({ width: 1280, height: 700 });
await page.setInputFiles("#fileInput", `${FIX}/big.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 60);
await page.waitForTimeout(1800);
const rendered = await page.evaluate(() => document.querySelectorAll(".page-tile canvas").length);
check("offscreen pages are not rendered up front", rendered < 60, rendered + "/60");

// Tag the live canvases, reorder, and check the same elements came back — a
// rebuilt grid must reuse cached thumbnails, not re-render them.
await page.evaluate(() =>
  document.querySelectorAll(".page-tile canvas").forEach((c, i) => { c.dataset.stamp = "s" + i; }));
await drag(0, 3);
check("reordering reuses rendered thumbnails, never re-renders", await page.evaluate(() => {
  const stamps = [...document.querySelectorAll(".page-tile canvas")].map(c => c.dataset.stamp);
  return stamps.filter(Boolean).length === stamps.length && new Set(stamps).size === stamps.length;
}));

// --- 11. responsive --------------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("undo stays reachable at 375px", await page.locator("#undoBtn").isVisible());
await page.screenshot({ path: path.join(TMP, "organize-375.png") });

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
