/* Watermark smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";
import { verifySignature } from "./signature.mjs";

const { check, report } = suite("watermark");
const { browser, page, errors } = await launch();

/* Text items in display space — the reader's view, with /Rotate applied. Each
   item's own width and height come back too, so a mark's centre can be worked
   out even when it's drawn at an angle. */
async function textItems(bytes){
  return page.evaluate(async arr => {
    const pdfjsLib = await window.ilikepdf.loadPdfJs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const out = [];
    for(let i = 1; i <= doc.numPages; i++){
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      const tc = await p.getTextContent();
      out.push({
        w: vp.width, h: vp.height,
        items: tc.items.map(it => {
          const m = pdfjsLib.Util.transform(vp.transform, it.transform);
          return { str: it.str, x: m[4], y: m[5], skew: m[1], w: it.width, h: it.height };
        })
      });
    }
    return out;
  }, [...bytes]);
}

/* How many images each page paints. The only way to prove an image watermark
   made it in — there is no text to read back. */
async function imageOps(bytes){
  return page.evaluate(async arr => {
    const pdfjsLib = await window.ilikepdf.loadPdfJs();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const paint = pdfjsLib.OPS.paintImageXObject;
    const out = [];
    for(let i = 1; i <= doc.numPages; i++){
      const ops = await (await doc.getPage(i)).getOperatorList();
      out.push(ops.fnArray.filter(fn => fn === paint).length);
    }
    return out;
  }, [...bytes]);
}

async function load(name, pages){
  await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
  await page.setInputFiles("#fileInput", `${FIX}/${name}`);
  await page.waitForSelector("#workspace.on");
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

const runIt = async () => {
  await page.locator(".btn-action").click();
  await page.waitForSelector("#done.on", { timeout: 25000 });
  return download();
};
const marks = () => page.locator('.page-tile[data-index="0"] .stamp').count();

// --- 1. loading and the default mark ---------------------------------------
await load("gamma.pdf", 5);
check("a tile per page", (await page.locator(".page-tile").count()) === 5);
check("one mark per page by default", (await marks()) === 1);
check("the mark previews the text",
  (await page.locator('.page-tile[data-index="0"] .stamp').textContent()) === "CONFIDENTIAL");
check("export is ready with the default text", !(await page.locator(".btn-action").isDisabled()));

await page.fill("#textInput", "");
check("empty text disables export", await page.locator(".btn-action").isDisabled());
check("the button says what's missing",
  (await page.locator(".btn-action").textContent()) === "Type some text first");
check("no mark is previewed with nothing to stamp", (await marks()) === 0);
/* Helvetica is WinAnsi-encoded, so drawText throws on anything outside it. The
   second pair matters as much as the first: a predicate that's too strict would
   refuse ordinary European text, which is a worse bug than the one it fixes. */
await page.fill("#textInput", "日本語テキスト");
check("text Helvetica can't draw disables export",
  await page.locator(".btn-action").isDisabled());
check("the button says why",
  (await page.locator(".btn-action").textContent()) === "Helvetica can't draw those characters");
await page.fill("#textInput", "Café — naïve");
check("WinAnsi accents and dashes are still allowed",
  !(await page.locator(".btn-action").isDisabled()));
check("and still export-ready",
  (await page.locator(".btn-action").textContent()) === "Add watermark");

await page.fill("#textInput", "DRAFT");
check("typing brings the mark back", (await marks()) === 1);
check("the preview follows the text",
  (await page.locator('.page-tile[data-index="0"] .stamp').textContent()) === "DRAFT");

// --- 2. tiling ------------------------------------------------------------
await page.fill("#textInput", "CONFIDENTIAL");
await page.locator("#tiled").check();
const tiledCount = await marks();
check("tiling repeats the mark", tiledCount > 1, tiledCount + " marks");
check("the summary agrees with the preview",
  (await page.locator(".summary").textContent()).replace(/\s+/g, " ")
    .includes("Marks per page: " + tiledCount));

await page.fill("#sizeInput", "14");
const smallCount = await marks();
check("a smaller mark tiles more densely", smallCount > tiledCount,
  `${smallCount} at 14pt vs ${tiledCount} at 48pt`);
await page.fill("#sizeInput", "48");
await page.locator("#tiled").uncheck();

// --- 3. what actually comes out --------------------------------------------
await page.fill("#angleInput", "0");     // straight, so positions are readable
let got = await runIt();
check("output is named after the source", got.name === "gamma_watermarked.pdf", got.name);
check("output is a PDF", got.bytes.subarray(0, 5).toString() === "%PDF-");

await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
let read = await textItems(got.bytes);
check("page count is unchanged", read.length === 5, read.length + " pages");
const perPage = read.map(p => p.items.filter(i => i.str === "CONFIDENTIAL").length);
check("every page carries the mark", perPage.join(",") === "1,1,1,1,1", perPage.join(","));
check("the original page text survives",
  read[0].items.some(i => i.str.includes("GAMMA - page 1 of 5")));

/* pdf.js reports where a run *starts*; the centre is half its extent further
   along, in whatever direction the run was drawn. At 0° that's just +w/2, but a
   45° mark runs diagonally and ignoring that puts the "centre" a tenth of a
   page out — so turn the offset by the same angle before adding it. */
const centreOf = (p, str, deg = 0) => {
  const it = p.items.find(i => i.str === str);
  if(!it) return null;
  const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const x = it.x + (it.w / 2) * cos - (it.h / 2) * sin;
  const y = it.y - ((it.w / 2) * sin + (it.h / 2) * cos);   // display y grows down
  return { x: x / p.w, y: y / p.h, skew: it.skew };
};
let c = centreOf(read[0], "CONFIDENTIAL");
check("the mark is centred on the page",
  Math.abs(c.x - 0.5) < 0.05 && Math.abs(c.y - 0.5) < 0.05,
  `${c.x.toFixed(3)},${c.y.toFixed(3)}`);
check("at 0° the mark is not skewed", Math.abs(c.skew) < 0.01, String(c.skew));

// --- 4. angle --------------------------------------------------------------
await load("gamma.pdf", 5);
await page.fill("#angleInput", "45");
got = await runIt();
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
read = await textItems(got.bytes);
c = centreOf(read[0], "CONFIDENTIAL", 45);
check("an angled mark really is rotated", Math.abs(c.skew) > 0.5, String(c.skew));
check("an angled mark is still centred",
  Math.abs(c.x - 0.5) < 0.03 && Math.abs(c.y - 0.5) < 0.03,
  `${c.x.toFixed(3)},${c.y.toFixed(3)}`);

// --- 5. tiled output matches the preview -----------------------------------
await load("gamma.pdf", 5);
await page.fill("#angleInput", "0");
await page.locator("#tiled").check();
const previewed = await marks();
got = await runIt();
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
read = await textItems(got.bytes);
const drawn = read[0].items.filter(i => i.str === "CONFIDENTIAL").length;
check("the export draws exactly what the preview showed", drawn === previewed,
  `${drawn} drawn vs ${previewed} previewed`);

// --- 6. a page that carries its own /Rotate --------------------------------
await load("prerotated.pdf", 2);
await page.fill("#angleInput", "0");
got = await runIt();
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
read = await textItems(got.bytes);
check("the fixture really is quarter-turned", read[0].w > read[0].h, `${read[0].w}x${read[0].h}`);
c = centreOf(read[0], "CONFIDENTIAL");
check("a rotated page is marked at its visible centre",
  c && Math.abs(c.x - 0.5) < 0.06 && Math.abs(c.y - 0.5) < 0.06,
  c && `${c.x.toFixed(3)},${c.y.toFixed(3)}`);
check("the mark reads upright on a rotated page",
  c && Math.abs(c.skew) < 0.01, c && String(c.skew));

// --- 7. image watermarks ---------------------------------------------------
await load("gamma.pdf", 5);
await page.setInputFiles("#imageInput", `${FIX}/logo.png`);
await page.waitForTimeout(500);
check("choosing an image switches to image mode",
  await page.locator('input[name="mode"][value="image"]').isChecked());
check("the image's dimensions are shown",
  (await page.locator("#imageName").textContent()).includes("240×120"));
check("the preview names the image",
  (await page.locator('.page-tile[data-index="0"] .stamp').textContent()) === "logo");

got = await runIt();
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
let ops = await imageOps(got.bytes);
check("every page paints one image", ops.join(",") === "1,1,1,1,1", ops.join(","));
read = await textItems(got.bytes);
check("an image watermark leaves the page text alone",
  read[0].items.some(i => i.str.includes("GAMMA - page 1 of 5")));
check("an image watermark draws no text",
  !read[0].items.some(i => i.str === "CONFIDENTIAL"));

// A JPEG goes down a different pdf-lib path than a PNG, and tiling multiplies it.
await load("beta.pdf", 2);
await page.setInputFiles("#imageInput", `${FIX}/wide.jpg`);
await page.waitForTimeout(400);
await page.locator("#tiled").check();
const imgTiles = await marks();
got = await runIt();
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
ops = await imageOps(got.bytes);
check("a tiled JPEG is painted once per tile, on every page",
  ops.join(",") === `${imgTiles},${imgTiles}`, ops.join(",") + " vs " + imgTiles);

// --- 8. rejections and restart ---------------------------------------------
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-PDF is rejected on the hero",
  (await page.locator("#heroError").textContent()).includes("isn't a PDF")
  && await page.locator("#hero").isVisible());

await load("gamma.pdf", 5);
await page.locator('input[name="mode"][value="image"]').check();
check("image mode with no image disables export",
  await page.locator(".btn-action").isDisabled());
check("the button says what's missing",
  (await page.locator(".btn-action").textContent()) === "Choose an image first");
await page.setInputFiles("#imageInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-image is refused as a watermark",
  (await page.locator(".panel .error").textContent()).includes("isn't a PNG or JPG"));

await page.locator('input[name="mode"][value="text"]').check();
await runIt();
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to the hero", await page.locator("#hero").isVisible());
check("restart clears the grid", (await page.locator(".page-tile").count()) === 0);
await page.setInputFiles("#fileInput", `${FIX}/alpha.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 3);
check("a second document loads after restart", (await page.locator(".page-tile").count()) === 3);
check("the watermark image is forgotten on restart",
  (await page.locator("#imageName").textContent()).includes("PNG or JPG"));

// --- 9. responsive ---------------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("the text field stays reachable at 375px", await page.locator("#textInput").isVisible());
check("the export button stays reachable at 375px", await page.locator(".btn-action").isVisible());
await page.screenshot({ path: path.join(TMP, "watermark-375.png") });

// --- 10. an export that fails says so --------------------------------------
/* The failure has to be injected into a page that already has pdf-lib on it,
   and reloading would throw the patch away — so export once to pull the library
   in, then restart, which returns to the hero without a navigation. */
await page.setViewportSize({ width: 1280, height: 900 });
await load("gamma.pdf", 5);
await runIt();
await page.locator("#restartBtn").click();
await page.setInputFiles("#fileInput", `${FIX}/gamma.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 5);
await page.evaluate(() => {
  window.PDFLib.PDFDocument.load = () => { throw new Error("forced"); };
});

const markNoise = errors.length;
await page.locator(".btn-action").click();
await page.waitForTimeout(600);
const markMsg = (await page.locator(".panel .error").textContent()).trim();
check("a failed watermark says so",
  (await page.locator(".panel .error").isVisible()) && markMsg.length > 0,
  JSON.stringify(markMsg));
check("a failed watermark doesn't claim success", !(await page.locator("#done").isVisible()));
check("the button is usable again after a failed watermark",
  !(await page.locator(".btn-action").isDisabled()));
// The console.error in the catch is the point of the test, not a defect.
errors.length = markNoise;

// --- a signed PDF, and the note that update() used to eat ------------------
/* Two things at once. The signature warning is the 10.7 case; that it is still
   on screen after a settings change is the regression test for the bug 10.7
   turned up — update() rendered `failure || imageError` and destroyed any
   intake note the moment any slider moved, so watermark's large-file warning
   and its multi-PDF note had never been visible at all. */
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/signed.pdf`);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 2);

const wmSig = () => page.locator(".panel .error").textContent().then(t => t.trim());
const wmFirst = await wmSig();
check("a signed PDF is called out", /digitally signed/i.test(wmFirst), JSON.stringify(wmFirst));
check("and is not accused of having form fields", !/form fields/i.test(wmFirst));

// Move a control, which is what calls update().
await page.locator("#opacityInput").evaluate(el =>
  el.dispatchEvent(new Event("input", { bubbles: true })));
await page.waitForTimeout(300);
check("the note survives a settings change", /digitally signed/i.test(await wmSig()),
  JSON.stringify(await wmSig()));

await page.fill("#textInput", "DRAFT");
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
const wmOut = await download();
const wmAfter = await verifySignature(wmOut.bytes);
check("watermarking leaves the signature in place but broken",
  wmAfter.present && !wmAfter.valid, wmAfter.why);

// --- a supplied font draws what Helvetica can't (12.2) ---------------------
/* 9.2 shipped "Helvetica can't draw those characters" as the honest refusal.
   This is the complete fix, and both halves are asserted: that the refusal is
   still there without a font, and that supplying one lifts it and really does
   put the character in the output.

   `tiny.ttf` is 776 bytes, built by make-font.mjs. It maps A, B and 日 and
   deliberately does not map 旦 (U+65E6), so the missing-glyph path has
   something to catch — a font covering everything couldn't test that. */
await load("gamma.pdf", 5);
await page.fill("#textInput", "日");
await page.waitForTimeout(200);
check("without a font, CJK is still refused",
  await page.locator(".btn-action").isDisabled() &&
  (await page.locator(".btn-action").textContent()) === "Helvetica can't draw those characters");
check("the hint says a font can be supplied",
  /\.ttf|\.otf/i.test(await page.locator("#fontName").textContent()));

await page.setInputFiles("#fontInput", `${FIX}/tiny.ttf`);
await page.waitForFunction(() => !document.querySelector(".btn-action").disabled,
  null, { timeout: 30000 });
check("supplying a font lifts the refusal",
  (await page.locator(".btn-action").textContent()) === "Add watermark");
check("the hint names the font and says it is subset",
  /tiny\.ttf/.test(await page.locator("#fontName").textContent()) &&
  /subset/i.test(await page.locator("#fontName").textContent()),
  await page.locator("#fontName").textContent());

/* A character the supplied font has no glyph for must be refused too. pdf-lib
   would not throw here — it would quietly draw nothing, which is the failure
   mode worth catching, and a different one from Helvetica's. */
await page.fill("#textInput", "旦");
await page.waitForTimeout(200);
check("a glyph the supplied font lacks is refused",
  await page.locator(".btn-action").isDisabled(), await page.locator(".btn-action").textContent());
check("and the button names the character",
  (await page.locator(".btn-action").textContent()).includes("旦"),
  await page.locator(".btn-action").textContent());

await page.fill("#textInput", "日");
await page.waitForTimeout(200);
const cjkMarks = Number((await page.locator(".summary").textContent()).match(/Marks per page:\s*(\d+)/)?.[1]);
const cjkOut = await runIt();
const cjkRead = await page.evaluate(async arr => {
  const pdfjsLib = await window.ilikepdf.loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
  const out = [];
  for(let i = 1; i <= doc.numPages; i++)
    out.push((await (await doc.getPage(i)).getTextContent()).items.map(x => x.str));
  return out;
}, [...cjkOut.bytes]);
check("the CJK mark is really in the output",
  cjkRead[0].includes("日"), JSON.stringify(cjkRead[0]));
check("on every page", cjkRead.every(p => p.includes("日")), cjkRead.length + " pages");
check("the original page text survives", cjkRead[0].some(s => s.includes("GAMMA - page 1 of 5")));
// Preview and export must agree — the invariant the whole helvetica.js file
// exists for, now resting on the supplied font's own metrics.
check("the preview's mark count is what got drawn",
  cjkRead[0].filter(s => s === "日").length === cjkMarks,
  `previewed ${cjkMarks}, drew ${cjkRead[0].filter(s => s === "日").length}`);

/* One mark agreeing proves little — the tile count is where a wrong width
   shows up, because it divides the page by the mark's measured size. */
await load("gamma.pdf", 5);
await page.setInputFiles("#fontInput", `${FIX}/tiny.ttf`);
await page.waitForFunction(() => /subset/.test(document.getElementById("fontName").textContent),
  null, { timeout: 30000 });
await page.fill("#textInput", "日");
await page.fill("#angleInput", "0");
await page.locator("#tiled").check();
await page.waitForTimeout(250);
const tiledPreview = Number((await page.locator(".summary").textContent()).match(/Marks per page:\s*(\d+)/)?.[1]);
check("a supplied font tiles more than once", tiledPreview > 1, tiledPreview + " marks");
const tiledOut = await runIt();
const tiledDrawn = await page.evaluate(async arr => {
  const pdfjsLib = await window.ilikepdf.loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
  return (await (await doc.getPage(1)).getTextContent()).items.filter(i => i.str === "日").length;
}, [...tiledOut.bytes]);
check("and the tiled count previewed is the count drawn",
  tiledDrawn === tiledPreview, `previewed ${tiledPreview}, drew ${tiledDrawn}`);
// A 6 MB face would subset to a few KB; this one is already tiny, so just check
// the font did not arrive whole.
check("the embedded font is subset, not shipped entire",
  cjkOut.bytes.length < 20000, (cjkOut.bytes.length / 1024).toFixed(1) + " KB");

// A file that isn't a font at all must say so rather than throw.
await page.setInputFiles("#fontInput", `${FIX}/notes.txt`);
await page.waitForFunction(() =>
  /couldn't be read as a font/i.test(document.querySelector(".panel .error").textContent),
  null, { timeout: 15000 }).catch(() => {});
check("a non-font is refused with a message",
  /couldn't be read as a font/i.test(await page.locator(".panel .error").textContent()),
  await page.locator(".panel .error").textContent());
errors.length = 0;   // the deliberate parse failure logs

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
