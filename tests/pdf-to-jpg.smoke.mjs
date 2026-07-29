/* PDF to JPG smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";

const { check, report } = suite("pdf-to-jpg");
const { browser, page, errors } = await launch();

/* Unzips in the page and decodes each entry, so the assertions are about real
   images at real sizes — a ZIP full of empty files would pass a byte count. */
async function unzip(bytes){
  return page.evaluate(async arr => {
    const JSZip = await window.ilikepdf.loadZip();
    const zip = await JSZip.loadAsync(new Uint8Array(arr));
    const names = Object.keys(zip.files).sort();
    const out = [];
    for(const name of names){
      const data = await zip.files[name].async("uint8array");
      const bitmap = await createImageBitmap(new Blob([data]));
      out.push({ name, bytes: data.length, w: bitmap.width, h: bitmap.height,
                 magic: [...data.slice(0, 4)] });
    }
    return out;
  }, [...bytes]);
}

/* One image, straight out of the download. */
async function decode(bytes){
  return page.evaluate(async arr => {
    const data = new Uint8Array(arr);
    const bitmap = await createImageBitmap(new Blob([data]));
    return { w: bitmap.width, h: bitmap.height, magic: [...data.slice(0, 4)] };
  }, [...bytes]);
}

const isJpeg = m => m[0] === 0xff && m[1] === 0xd8;
const isPng  = m => m[0] === 0x89 && m[1] === 0x50;

async function load(name, pages){
  await page.goto(BASE + "/pdf-to-jpg.html", { waitUntil: "networkidle" });
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
  await page.waitForSelector("#done.on", { timeout: 30000 });
  return download();
};

// --- 1. loading ------------------------------------------------------------
await load("gamma.pdf", 5);          // 5 pages, A4 (595x842)
check("a tile per page", (await page.locator(".page-tile").count()) === 5);
check("every page is included by default",
  (await page.locator(".page-tile.selected").count()) === 5);
check("the button counts the images",
  (await page.locator(".btn-action").textContent()) === "Convert 5 pages");
check("the summary warns about the ZIP",
  (await page.locator(".summary").textContent()).includes("zipped"));

/* Nothing here writes a PDF, so pdf-lib should never be fetched. */
const loaded = () => page.evaluate(() =>
  [...document.querySelectorAll("script[src]")].map(s => s.getAttribute("src")));
/* Content-hashed in dist/, so match the shape, not the literal name. */
const PDFLIB = /(^|\/)pdf-lib(\.[a-z0-9]+)?\.min\.js$/;
check("pdf-lib is never loaded — nothing here writes a PDF",
  !(await loaded()).some(s => PDFLIB.test(s)), (await loaded()).join(" "));

// --- 2. picking pages ------------------------------------------------------
await page.locator('input[name="mode"][value="pick"]').check();
check("switching to pick clears the selection",
  (await page.locator(".page-tile.selected").count()) === 0);
check("export is disabled with nothing picked",
  await page.locator(".btn-action").isDisabled());
check("the button says why", (await page.locator(".btn-action").textContent())
  === "Pick at least one page");

await page.locator('.page-tile[data-index="1"]').click();
await page.locator('.page-tile[data-index="3"]').click();
check("clicking pages selects them", (await page.locator(".page-tile.selected").count()) === 2);
check("two pages is still a ZIP",
  (await page.locator(".btn-action").textContent()) === "Convert 2 pages");
await page.locator("#selectAll").click();
check("select all picks everything", (await page.locator(".page-tile.selected").count()) === 5);
await page.locator("#selectNone").click();
check("clear unpicks everything", (await page.locator(".page-tile.selected").count()) === 0);

// --- 3. a single page downloads as an image, not a ZIP ---------------------
await page.locator('.page-tile[data-index="2"]').click();
check("one page offers a single image",
  (await page.locator(".btn-action").textContent()) === "Convert to JPG");
let got = await runIt();
check("a single image is named after its page", got.name === "gamma_page_3.jpg", got.name);
check("the done screen speaks in the singular",
  (await page.locator("#doneTitle").textContent()) === "Your image is ready");
check("the download button offers the image, not a ZIP",
  (await page.locator("#downloadBtn").textContent()) === "Download JPG");

let img = await decode(got.bytes);
check("the download really is a JPEG", isJpeg(img.magic), got.bytes.subarray(0, 4).toString("hex"));
check("2x is twice the page size", img.w === 1190 && img.h === 1684, `${img.w}x${img.h}`);

// --- 4. every page, zipped -------------------------------------------------
await load("gamma.pdf", 5);
got = await runIt();
check("several images are zipped", got.name === "gamma_jpg.zip", got.name);
check("the file really is a ZIP", got.bytes.subarray(0, 2).toString() === "PK");
check("the download button offers the ZIP",
  (await page.locator("#downloadBtn").textContent()) === "Download ZIP");
check("the done screen counts them",
  (await page.locator("#doneTitle").textContent()) === "Your PDF is now 5 images");

let entries = await unzip(got.bytes);
check("one entry per page", entries.length === 5, entries.length + " entries");
check("entries are named after their pages",
  entries.map(e => e.name).join(",")
    === "gamma_page_1.jpg,gamma_page_2.jpg,gamma_page_3.jpg,gamma_page_4.jpg,gamma_page_5.jpg",
  entries.map(e => e.name).join(","));
check("every entry decodes as a JPEG", entries.every(e => isJpeg(e.magic)));
check("every entry is a full-size image",
  entries.every(e => e.w === 1190 && e.h === 1684),
  entries.map(e => `${e.w}x${e.h}`).join(" "));
check("no entry is empty", entries.every(e => e.bytes > 500),
  entries.map(e => e.bytes).join(","));

// --- 5. scale and format ---------------------------------------------------
await load("onepage.pdf", 1);
await page.selectOption("#scaleSel", "1");
got = await runIt();
img = await decode(got.bytes);
check("1x matches the page's own size", img.w === 595 && img.h === 842, `${img.w}x${img.h}`);

await load("onepage.pdf", 1);
await page.selectOption("#scaleSel", "3");
got = await runIt();
img = await decode(got.bytes);
check("3x is three times the page size", img.w === 1785 && img.h === 2526, `${img.w}x${img.h}`);

await load("onepage.pdf", 1);
check("the quality slider is offered for JPG",
  await page.locator("#qualityWrap").isVisible());
await page.selectOption("#formatSel", "png");
check("PNG hides the quality slider — it's lossless",
  !(await page.locator("#qualityWrap").isVisible()));
check("the button offers a PNG",
  (await page.locator(".btn-action").textContent()) === "Convert to PNG");
got = await runIt();
check("a PNG download is named .png", got.name === "onepage_page_1.png", got.name);
img = await decode(got.bytes);
check("the download really is a PNG", isPng(img.magic));

/* Quality has to actually do something, or the control is decoration. */
await load("gamma.pdf", 5);
await page.locator('input[name="mode"][value="pick"]').check();
await page.locator('.page-tile[data-index="0"]').click();
await page.fill("#qualityInput", "100");
const big = (await runIt()).bytes.length;
await load("gamma.pdf", 5);
await page.locator('input[name="mode"][value="pick"]').check();
await page.locator('.page-tile[data-index="0"]').click();
await page.fill("#qualityInput", "40");
const small = (await runIt()).bytes.length;
check("lower quality makes a smaller file", small < big, `${small} at 40% vs ${big} at 100%`);

// --- 6. a page that carries its own /Rotate --------------------------------
/* pdf.js's default viewport applies /Rotate, so a quarter-turned page must come
   out landscape rather than sideways-portrait. */
await load("prerotated.pdf", 2);
await page.selectOption("#scaleSel", "1");
await page.locator('input[name="mode"][value="pick"]').check();
await page.locator('.page-tile[data-index="0"]').click();
got = await runIt();
img = await decode(got.bytes);
check("a rotated page comes out the way it's read",
  img.w === 842 && img.h === 595, `${img.w}x${img.h}`);

// --- 7. rejections and restart ---------------------------------------------
await page.goto(BASE + "/pdf-to-jpg.html", { waitUntil: "networkidle" });
check("the page says what it can't convert",
  (await page.locator(".hero-note").textContent()).includes("Word or Excel"));
await page.setInputFiles("#fileInput", `${FIX}/notes.txt`);
await page.waitForTimeout(300);
check("a non-PDF is rejected on the hero",
  (await page.locator("#heroError").textContent()).includes("isn't a PDF")
  && await page.locator("#hero").isVisible());

await load("beta.pdf", 2);
await runIt();
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to the hero", await page.locator("#hero").isVisible());
check("restart clears the grid", (await page.locator(".page-tile").count()) === 0);
await page.setInputFiles("#fileInput", `${FIX}/alpha.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".page-tile").length === 3);
check("a second document loads after restart",
  (await page.locator(".page-tile").count()) === 3);
got = await runIt();
check("converting twice works (buffers not detached)",
  got.bytes.subarray(0, 2).toString() === "PK");

// --- 8. responsive ---------------------------------------------------------
await load("gamma.pdf", 5);
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
check("the format picker stays reachable at 375px", await page.locator("#formatSel").isVisible());
check("the export button stays reachable at 375px", await page.locator(".btn-action").isVisible());
await page.screenshot({ path: path.join(TMP, "pdf-to-jpg-375.png") });

check("no console errors", errors.length === 0, errors.join(" || "));

await browser.close();
report();
