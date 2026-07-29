/* JPG to PDF smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";

const { check, report } = suite("jpg-to-pdf");
const { browser, page, errors } = await launch();

/* Page sizes and the images painted on them. Page size is the whole point of
   this tool's options, and an image that failed to embed leaves an empty page
   that a byte count would happily call a success. */
async function inspect(bytes){
  return page.evaluate(async arr => {
    const pdfjsLib = await window.ilikepdf.loadPdfJs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const paint = pdfjsLib.OPS.paintImageXObject;
    const out = [];
    for(let i = 1; i <= doc.numPages; i++){
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      const ops = await p.getOperatorList();
      out.push({
        w: Math.round(vp.width), h: Math.round(vp.height),
        images: ops.fnArray.filter(fn => fn === paint).length
      });
    }
    return out;
  }, [...bytes]);
}

async function load(files){
  await page.goto(BASE + "/jpg-to-pdf.html", { waitUntil: "networkidle" });
  await page.setInputFiles("#fileInput", files.map(f => `${FIX}/${f}`));
  await page.waitForSelector("#workspace.on");
  await page.waitForFunction(n => document.querySelectorAll(".page-tile canvas").length === n,
    files.length, { timeout: 15000 });
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

const runIt = async () => {
  await page.locator(".btn-action").click();
  await page.waitForSelector("#done.on", { timeout: 25000 });
  return download();
};
const captions = () => page.locator(".page-tile .page-no").allTextContents();

// --- 1. loading ------------------------------------------------------------
await load(["logo.png", "wide.jpg", "tall.jpg"]);
check("a tile per image", (await page.locator(".page-tile").count()) === 3);
check("tiles are captioned with their pixel size",
  (await captions()).join(",") === "240×120,400×200,200×400", (await captions()).join(","));
check("order badges show the page order",
  (await page.locator(".page-tile .order").allTextContents()).join(",") === "1,2,3");
check("the header counts the images",
  (await page.locator("#srcName").textContent()) === "3 images");
check("export is enabled", !(await page.locator(".btn-action").isDisabled()));

/* This is the tool that proves lazy loading is worth having: there is no PDF to
   preview, so pdf.js should never be fetched. */
const loaded = () => page.evaluate(() =>
  [...document.querySelectorAll("script[src]")].map(s => s.getAttribute("src")));
check("pdf.js is never loaded — there is no PDF to preview",
  !(await loaded()).some(s => s.includes("pdf.min.js")), (await loaded()).join(" "));
check("pdf-lib is not loaded before Export either",
  !(await loaded()).some(s => s.includes("pdf-lib")), (await loaded()).join(" "));

// --- 2. reordering ---------------------------------------------------------
/* The ← → buttons only show under hover:none, so drive them the way merge and
   organize do: dispatch the click rather than asking a mouse to find them. */
const move = (i, dir) => page.evaluate(([i, dir]) =>
  document.querySelectorAll(".page-tile")[i].querySelector(`[data-action="${dir}"]`).click(),
  [i, dir]);

await move(0, "right");
check("move right swaps the first two",
  (await captions()).join(",") === "400×200,240×120,200×400");
await move(1, "left");
check("move left puts it back",
  (await captions()).join(",") === "240×120,400×200,200×400");
await move(0, "left");
check("move left at the start does nothing",
  (await captions()).join(",") === "240×120,400×200,200×400");

// --- 3. fit-to-image, the default ------------------------------------------
let got = await runIt();
check("several images get a generic name", got.name === "ilikepdf_images.pdf", got.name);
check("output is a PDF", got.bytes.subarray(0, 5).toString() === "%PDF-");

await page.goto(BASE + "/jpg-to-pdf.html", { waitUntil: "networkidle" });
let pages = await inspect(got.bytes);
check("one page per image", pages.length === 3, pages.length + " pages");
check("every page paints its image", pages.every(p => p.images === 1),
  pages.map(p => p.images).join(","));
check("fit mode makes each page the size of its image",
  pages.map(p => `${p.w}x${p.h}`).join(",") === "240x120,400x200,200x400",
  pages.map(p => `${p.w}x${p.h}`).join(","));
check("page order follows the grid order", pages[0].w === 240 && pages[2].h === 400);

// --- 4. fixed page sizes ---------------------------------------------------
await load(["logo.png", "tall.jpg"]);
await page.selectOption("#sizeSel", "a4");
check("the hint changes with the page size",
  (await page.locator("#sizeHint").textContent()).includes("centred and scaled"));
got = await runIt();
await page.goto(BASE + "/jpg-to-pdf.html", { waitUntil: "networkidle" });
pages = await inspect(got.bytes);
check("a wide image gets a landscape A4 page",
  pages[0].w === 842 && pages[0].h === 595, `${pages[0].w}x${pages[0].h}`);
check("a tall image gets a portrait A4 page",
  pages[1].w === 595 && pages[1].h === 842, `${pages[1].w}x${pages[1].h}`);

await load(["logo.png"]);
await page.selectOption("#sizeSel", "a4");
await page.locator("#autoRotate").uncheck();
got = await runIt();
await page.goto(BASE + "/jpg-to-pdf.html", { waitUntil: "networkidle" });
pages = await inspect(got.bytes);
check("without auto-rotate a wide image stays on a portrait page",
  pages[0].w === 595 && pages[0].h === 842, `${pages[0].w}x${pages[0].h}`);

await load(["logo.png"]);
await page.selectOption("#sizeSel", "letter");
got = await runIt();
await page.goto(BASE + "/jpg-to-pdf.html", { waitUntil: "networkidle" });
pages = await inspect(got.bytes);
check("Letter is 612x792, turned for a wide image",
  pages[0].w === 792 && pages[0].h === 612, `${pages[0].w}x${pages[0].h}`);

// --- 5. margins ------------------------------------------------------------
await load(["logo.png"]);
await page.fill("#marginInput", "40");
got = await runIt();
await page.goto(BASE + "/jpg-to-pdf.html", { waitUntil: "networkidle" });
pages = await inspect(got.bytes);
check("in fit mode a margin grows the page around the image",
  pages[0].w === 320 && pages[0].h === 200, `${pages[0].w}x${pages[0].h}`);

// --- 6. one image, named after itself --------------------------------------
await load(["tall.jpg"]);
got = await runIt();
check("a single image is named after itself", got.name === "tall.pdf", got.name);

// --- 7. rejections, clearing and restart -----------------------------------
await page.goto(BASE + "/jpg-to-pdf.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-image is rejected on the hero",
  (await page.locator("#heroError").textContent()).includes("aren't images")
  && await page.locator("#hero").isVisible());

await page.setInputFiles("#fileInput", `${FIX}/alpha.pdf`);
await page.waitForTimeout(300);
check("a PDF is not an image either",
  (await page.locator("#heroError").textContent()).includes("aren't images"));

await load(["logo.png", "wide.jpg"]);
await page.setInputFiles("#fileInput", [`${FIX}/tall.jpg`, `${FIX}/notes.txt`]);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 3);
check("a mixed drop keeps the images", (await page.locator(".page-tile").count()) === 3);
check("and names what it skipped",
  (await page.locator(".panel .error").textContent()).includes("notes.txt"));

await page.evaluate(() => document.querySelector(".page-tile .remove").click());
await page.waitForTimeout(200);
check("removing a tile drops that image", (await page.locator(".page-tile").count()) === 2);
await page.locator("#clearBtn").click();
await page.waitForTimeout(200);
check("clear empties the list and returns to the hero",
  (await page.locator(".page-tile").count()) === 0 && await page.locator("#hero").isVisible());

await load(["logo.png"]);
await runIt();
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to the hero", await page.locator("#hero").isVisible());
await page.setInputFiles("#fileInput", `${FIX}/wide.jpg`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 1);
check("a second batch loads after restart",
  (await captions()).join(",") === "400×200");
got = await runIt();
check("converting twice works (buffers not detached)",
  got.bytes.subarray(0, 5).toString() === "%PDF-" && got.bytes.length > 0);

// --- 8. responsive ---------------------------------------------------------
await load(["logo.png", "tall.jpg"]);   // back to the workspace, not the done screen
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("the export button stays reachable at 375px", await page.locator(".btn-action").isVisible());
await page.screenshot({ path: path.join(TMP, "jpg-to-pdf-375.png") });

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
