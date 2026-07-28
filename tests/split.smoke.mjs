/* Split PDF smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";
import { parseRanges } from "../js/core/ranges.js";

const { check, report } = suite("split");
const { browser, page, errors } = await launch();

/* Reads a produced PDF back with pdf.js and returns its page count and the text
   of every page, so we can prove which source pages actually came out. */
async function inspect(bytes){
  return page.evaluate(async arr => {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
    const pages = [];
    for(let i = 1; i <= doc.numPages; i++){
      const t = await (await doc.getPage(i)).getTextContent();
      pages.push(t.items.map(x => x.str).join(""));
    }
    return { count: doc.numPages, pages };
  }, [...bytes]);
}

async function loadGamma(){
  await page.goto(BASE + "/split.html", { waitUntil: "networkidle" });
  await page.setInputFiles("#fileInput", `${FIX}/gamma.pdf`);   // 5 pages
  await page.waitForSelector("#workspace.on");
  await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 5);
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

// --- 1. range parsing, pure ------------------------------------------------
const ok = (t, max) => parseRanges(t, max);
check("parses a single range", JSON.stringify(ok("1-4", 10).ranges) === '[{"from":1,"to":4}]');
check("parses a bare page as a one-page range", JSON.stringify(ok("7", 10).ranges) === '[{"from":7,"to":7}]');
check("parses the spec's example", JSON.stringify(ok("1-4, 7, 9-12", 12).ranges)
  === '[{"from":1,"to":4},{"from":7,"to":7},{"from":9,"to":12}]');
check("tolerates loose spacing", JSON.stringify(ok(" 1 - 4 ;7 ", 10).ranges)
  === '[{"from":1,"to":4},{"from":7,"to":7}]');
check("empty input is not an error", ok("", 10).ranges.length === 0 && ok("", 10).error === null);
check("rejects gibberish", !!ok("abc", 10).error);
check("rejects page 0", !!ok("0-3", 10).error);
check("rejects a backwards range", !!ok("8-2", 10).error);
check("rejects past the last page", !!ok("1-99", 10).error, ok("1-99", 10).error);
check("out-of-range error names the real page count", ok("1-99", 10).error.includes("10 pages"));

// --- 2. loading a document -------------------------------------------------
await loadGamma();
check("a tile per page", (await page.locator(".page-tile").count()) === 5);
check("filename is shown", (await page.locator("#srcName").textContent()) === "gamma.pdf");
check("page count is shown", (await page.locator("#srcMeta").textContent()).includes("5 pages"));
check("range field defaults to the whole document",
  (await page.locator("#rangeInput").inputValue()) === "1-5");
check("thumbnails render", await page.evaluate(async () => {
  await new Promise(r => setTimeout(r, 1500));
  return document.querySelectorAll(".page-tile canvas").length === 5;
}));

// --- 3. range mode ---------------------------------------------------------
await page.fill("#rangeInput", "2-3");
check("selection follows the range", await page.evaluate(() =>
  [...document.querySelectorAll(".page-tile")].map(t => t.classList.contains("selected")).join(",")
) === "false,true,true,false,false");
check("summary counts pages and files",
  (await page.locator(".summary").textContent()).replace(/\s+/g, " ").includes("2"));
check("single range means one output", (await page.locator(".btn-action").textContent()) === "Split PDF");

await page.fill("#rangeInput", "1-2, 4");
check("two ranges mean two outputs",
  (await page.locator(".btn-action").textContent()) === "Split into 2 files");
check("pages are tagged with their output number", await page.evaluate(() =>
  [...document.querySelectorAll(".page-tile .mark")].map(m => m.textContent).join(",")
) === "1,1,,2,");

await page.fill("#rangeInput", "9-9");
check("a bad range shows an error", await page.locator(".panel .error").isVisible());
check("a bad range disables the button", await page.locator(".btn-action").isDisabled());
await page.fill("#rangeInput", "1-2, 4");
check("fixing the range clears the error", !(await page.locator(".panel .error").isVisible()));

// --- 4. range mode output --------------------------------------------------
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
check("multi-output download is a ZIP",
  (await page.locator("#downloadBtn").textContent()) === "Download ZIP");
let got = await download();
check("zip filename is named after the source", got.name === "gamma_split.zip", got.name);
check("zip is non-empty", got.bytes.length > 0, got.bytes.length + " bytes");
check("file is really a ZIP", got.bytes.subarray(0, 2).toString() === "PK");
// Unpack in the browser with the JSZip the page already has.
const entries = await page.evaluate(async arr => {
  const zip = await JSZip.loadAsync(new Uint8Array(arr));
  const names = Object.keys(zip.files).sort();
  const out = [];
  for(const n of names){
    const bytes = await zip.files[n].async("uint8array");
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    const texts = [];
    for(let i = 1; i <= doc.numPages; i++){
      const t = await (await doc.getPage(i)).getTextContent();
      texts.push(t.items.map(x => x.str).join(""));
    }
    out.push({ name: n, pages: doc.numPages, texts });
  }
  return out;
}, [...got.bytes]);
check("zip holds one PDF per range", entries.length === 2, JSON.stringify(entries.map(e => e.name)));
check("range files are named after their pages",
  entries.map(e => e.name).join(",") === "gamma_page_4.pdf,gamma_pages_1-2.pdf",
  entries.map(e => e.name).join(","));
check("1-2 produced a 2-page PDF of pages 1 and 2",
  entries[1].pages === 2 && entries[1].texts[0].includes("page 1") && entries[1].texts[1].includes("page 2"),
  JSON.stringify(entries[1]));
check("4 produced a 1-page PDF of page 4",
  entries[0].pages === 1 && entries[0].texts[0].includes("page 4"),
  JSON.stringify(entries[0]));

// --- 5. extract mode -------------------------------------------------------
await loadGamma();
await page.locator('input[name="mode"][value="extract"]').check();
check("extract mode disables the button until pages are picked",
  await page.locator(".btn-action").isDisabled());
check("extract mode prompts for a pick",
  (await page.locator(".btn-action").textContent()) === "Pick at least one page");
check("tiles are clickable in extract mode",
  !(await page.locator(".page-tile").first().isDisabled()));

await page.locator(".page-tile").nth(4).click();
await page.locator(".page-tile").nth(0).click();
check("clicking marks pages selected", (await page.locator(".page-tile.selected").count()) === 2);
check("picked pages get a check mark", await page.evaluate(() =>
  [...document.querySelectorAll(".page-tile")].map(t => t.querySelector(".mark").textContent).join(",")
) === "✓,,,,✓");
await page.locator(".page-tile").nth(0).click();
check("clicking again deselects", (await page.locator(".page-tile.selected").count()) === 1);
await page.locator("#selectAll").click();
check("select all picks every page", (await page.locator(".page-tile.selected").count()) === 5);
await page.locator("#selectNone").click();
check("clear deselects everything", (await page.locator(".page-tile.selected").count()) === 0);

await page.locator(".page-tile").nth(0).click();
await page.locator(".page-tile").nth(2).click();
await page.locator(".page-tile").nth(4).click();
check("extract makes a single file", (await page.locator(".btn-action").textContent()) === "Split PDF");
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
check("single output downloads as a PDF",
  (await page.locator("#downloadBtn").textContent()) === "Download PDF");
got = await download();
check("extract filename", got.name === "gamma_extracted.pdf", got.name);
check("extracted file is a PDF", got.bytes.subarray(0, 5).toString() === "%PDF-");
let info = await inspect(got.bytes);
check("extract produced one PDF with the picked pages", info.count === 3, "pages: " + info.count);
check("extracted pages are 1, 3 and 5 in order",
  info.pages[0].includes("page 1") && info.pages[1].includes("page 3") && info.pages[2].includes("page 5"),
  JSON.stringify(info.pages));

// --- 6. every-page mode ----------------------------------------------------
await loadGamma();
await page.locator('input[name="mode"][value="every"]').check();
check("every page mode selects all pages", (await page.locator(".page-tile.selected").count()) === 5);
check("every page mode makes one file per page",
  (await page.locator(".btn-action").textContent()) === "Split into 5 files");
check("tiles are not clickable in every-page mode",
  await page.locator(".page-tile").first().isDisabled());
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
got = await download();
check("every-page output is a ZIP", got.name === "gamma_split.zip" && got.bytes.subarray(0, 2).toString() === "PK");
const burst = await page.evaluate(async arr => {
  const zip = await JSZip.loadAsync(new Uint8Array(arr));
  const names = Object.keys(zip.files).sort();
  const counts = [];
  for(const n of names){
    const doc = await pdfjsLib.getDocument({ data: await zip.files[n].async("uint8array") }).promise;
    counts.push(doc.numPages);
  }
  return { names, counts };
}, [...got.bytes]);
check("every page became its own file", burst.names.length === 5, burst.names.join(","));
check("burst files are named per page",
  burst.names.join(",") === "gamma_page_1.pdf,gamma_page_2.pdf,gamma_page_3.pdf,gamma_page_4.pdf,gamma_page_5.pdf",
  burst.names.join(","));
check("each burst file has exactly one page", burst.counts.every(c => c === 1), burst.counts.join(","));

// --- 7. single-page document edge case -------------------------------------
await page.goto(BASE + "/split.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/onepage.pdf`);
await page.waitForSelector("#workspace.on");
check("a one-page PDF loads", (await page.locator(".page-tile").count()) === 1);
check("range defaults to 1-1", (await page.locator("#rangeInput").inputValue()) === "1-1");
await page.locator('input[name="mode"][value="every"]').check();
check("every-page on one page yields a single PDF, not a ZIP",
  (await page.locator(".btn-action").textContent()) === "Split PDF");
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
got = await download();
check("one-page burst downloads a PDF directly",
  got.name === "onepage_page_1.pdf" && got.bytes.subarray(0, 5).toString() === "%PDF-", got.name);

// --- 8. rejections and restart ---------------------------------------------
await page.goto(BASE + "/split.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-PDF is rejected on the hero, not in an empty workspace",
  (await page.locator("#heroError").textContent()).includes("isn't a PDF")
  && await page.locator("#hero").isVisible());
check("no tiles for a rejected file", (await page.locator(".page-tile").count()) === 0);

await loadGamma();
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to the hero", await page.locator("#hero").isVisible());
check("restart clears the grid", (await page.locator(".page-tile").count()) === 0);
await page.setInputFiles("#fileInput", `${FIX}/alpha.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 3);
check("a second document loads after restart", (await page.locator(".page-tile").count()) === 3);

// --- 9. lazy thumbnails ----------------------------------------------------
await page.goto(BASE + "/split.html", { waitUntil: "networkidle" });
await page.setViewportSize({ width: 1280, height: 700 });
await page.setInputFiles("#fileInput", `${FIX}/big.pdf`);      // 60 pages
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 60);
await page.waitForTimeout(1800);
const rendered = await page.evaluate(() => document.querySelectorAll(".page-tile canvas").length);
check("offscreen pages are not rendered up front", rendered < 60, rendered + "/60 rendered");
check("visible pages are rendered", rendered > 0, rendered + " rendered");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(2500);
const afterScroll = await page.evaluate(() => document.querySelectorAll(".page-tile canvas").length);
check("scrolling renders more pages", afterScroll > rendered, rendered + " → " + afterScroll);

// --- 10. responsive --------------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("mode controls stay usable at 375px", await page.locator(".modes").isVisible());
check("the action button is reachable at 375px", await page.locator(".btn-action").isVisible());
await page.screenshot({ path: path.join(TMP, "split-375.png") });

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
