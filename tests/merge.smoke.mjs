/* Merge PDF smoke test. Not part of the shipped site — dev tooling only.
 *
 *   python3 -m http.server 8000 &
 *   npm i playwright-core && npx playwright install chromium
 *   BASE=http://localhost:8000 node tests/merge.smoke.mjs
 *
 * Set CHROME to a browser executable if playwright-core can't find one.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:8000";
const FIX = path.join(HERE, "fixtures");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ilikepdf-"));
const EXE = process.env.CHROME || findChrome();

function findChrome(){
  const root = path.join(os.homedir(), ".cache/ms-playwright");
  if(!fs.existsSync(root)) return undefined;   // let playwright-core try its default
  for(const dir of fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().reverse()){
    for(const rel of ["chrome-linux64/chrome", "chrome-linux/chrome",
                      "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]){
      const p = path.join(root, dir, rel);
      if(fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const pass = [], fail = [];
const check = (name, ok, detail = "") =>
  (ok ? pass : fail).push(name + (detail ? "  → " + detail : ""));

const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text() + " @ " + JSON.stringify(m.location())); });
page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));
page.on("response", r => { if (r.status() >= 400) consoleErrors.push("HTTP " + r.status() + " " + r.url()); });

await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });

// --- 1. initial view -------------------------------------------------------
check("hero visible on load", await page.locator("#hero").isVisible());
check("workspace hidden on load", !(await page.locator("#workspace").isVisible()));
check("action button starts disabled", await page.locator(".btn-action").isDisabled());

// --- 2. add three PDFs -----------------------------------------------------
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/beta.pdf`, `${FIX}/gamma.pdf`]);
await page.waitForSelector("#workspace.on");
check("workspace shown after adding files", await page.locator("#workspace").isVisible());
check("hero hidden after adding files", !(await page.locator("#hero").isVisible()));

await page.waitForFunction(() => document.querySelectorAll(".thumb-box canvas").length === 3, null, { timeout: 15000 });
check("three thumbnails rendered", true);
check("cards count is 3", (await page.locator(".card").count()) === 3);
check("add-more card present", (await page.locator(".add-card").count()) === 1);

const metas = await page.locator(".card .meta").allTextContents();
check("page counts read correctly", metas[0].startsWith("3 pages") && metas[1].startsWith("2 pages") && metas[2].startsWith("5 pages"), metas.join(" | "));

const summary = await page.locator(".summary").textContent();
check("summary reports 3 files / 10 pages", summary.includes("3") && summary.includes("10"), summary.trim());
check("action button enabled with 3 files", !(await page.locator(".btn-action").isDisabled()));
check("action button label", (await page.locator(".btn-action").textContent()) === "Merge PDF");

const names = () => page.locator(".card .name").allTextContents();
check("initial order alpha,beta,gamma", (await names()).join(",") === "alpha.pdf,beta.pdf,gamma.pdf");
const orderBadges = await page.locator(".card .order").allTextContents();
check("order badges are 1,2,3", orderBadges.join(",") === "1,2,3");

// --- 3. reorder with the touch move buttons --------------------------------
await page.evaluate(() => document.querySelectorAll(".card")[0].querySelector('[data-dir="1"]').click());
check("move-right swaps first two", (await names()).join(",") === "beta.pdf,alpha.pdf,gamma.pdf", (await names()).join(","));
await page.evaluate(() => document.querySelectorAll(".card")[1].querySelector('[data-dir="-1"]').click());
check("move-left restores order", (await names()).join(",") === "alpha.pdf,beta.pdf,gamma.pdf");
await page.evaluate(() => document.querySelectorAll(".card")[0].querySelector('[data-dir="-1"]').click());
check("move-left at index 0 is a no-op", (await names()).join(",") === "alpha.pdf,beta.pdf,gamma.pdf");

// --- 4. HTML5 drag reorder (synthetic events through the real handlers) ----
await page.evaluate(() => {
  const cards = [...document.querySelectorAll(".card")];
  const dt = new DataTransfer();
  cards[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
  const r = cards[2].getBoundingClientRect();
  cards[2].dispatchEvent(new DragEvent("dragover", {
    bubbles: true, cancelable: true, dataTransfer: dt,
    clientX: r.left + r.width * 0.9, clientY: r.top + r.height / 2
  }));
});
check("drag alpha past gamma reorders to beta,gamma,alpha", (await names()).join(",") === "beta.pdf,gamma.pdf,alpha.pdf", (await names()).join(","));
await page.evaluate(() => document.querySelector(".card").dispatchEvent(new DragEvent("dragend", { bubbles: true })));
check("dragging class cleared after dragend", (await page.locator(".card.dragging").count()) === 0);

// --- 5. non-PDF rejection --------------------------------------------------
await page.setInputFiles("#fileInput", [`${FIX}/notes.txt`]);
await page.waitForTimeout(200);
check("non-PDF shows error", (await page.locator(".error").isVisible()) && (await page.locator(".error").textContent()).includes("aren't PDFs"));
check("non-PDF did not add a card", (await page.locator(".card").count()) === 3);

// --- 6. remove -------------------------------------------------------------
await page.evaluate(() => document.querySelectorAll(".card")[1].querySelector(".remove").click());
check("remove drops a card", (await page.locator(".card").count()) === 2);
const sum2 = await page.locator(".summary").textContent();
check("summary updates after remove", sum2.includes("2"), sum2.trim());

// re-add gamma so we merge 3 files / 10 pages
await page.setInputFiles("#fileInput", [`${FIX}/gamma.pdf`]);
await page.waitForFunction(() => document.querySelectorAll(".thumb-box canvas").length === 3, null, { timeout: 15000 });

// --- 7. merge --------------------------------------------------------------
const pagesBefore = await page.evaluate(() =>
  [...document.querySelectorAll(".card .meta")].reduce((n, m) => n + parseInt(m.textContent), 0));
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
check("done screen shown after merge", await page.locator("#done").isVisible());
const doneMeta = await page.locator("#doneMeta").textContent();
check("done meta reports every input page", doneMeta.includes(pagesBefore + " pages"), doneMeta + " (expected " + pagesBefore + " pages)");

// --- 8. download -----------------------------------------------------------
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("#downloadBtn").click()
]);
check("download filename", download.suggestedFilename() === "ilikepdf_merged.pdf", download.suggestedFilename());
const out = path.join(TMP, "merged.pdf");
await download.saveAs(out);
const bytes = fs.readFileSync(out);
check("downloaded file is non-empty", bytes.length > 0, bytes.length + " bytes");
check("downloaded file is a PDF", bytes.subarray(0, 5).toString() === "%PDF-");
// pdf-lib saves with object streams, so page dicts aren't greppable in plaintext.
// Parse it back with pdf.js instead.
const parsed = await page.evaluate(async arr => {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
  const txt = await (await doc.getPage(1)).getTextContent();
  return { pages: doc.numPages, first: txt.items.map(i => i.str).join("") };
}, [...bytes]);
check("merged PDF really has " + pagesBefore + " pages", parsed.pages === pagesBefore, "got " + parsed.pages);
// The list was reordered to beta,alpha,gamma above, so page 1 must come from beta.
check("merged output honours the reordered list", parsed.first.includes("BETA - page 1"), parsed.first);

// --- 9. start over ---------------------------------------------------------
await page.locator("#restartBtn").click();
await page.waitForTimeout(200);
check("restart returns to hero", await page.locator("#hero").isVisible());
check("restart hides done screen", !(await page.locator("#done").isVisible()));
check("restart empties the grid", (await page.locator(".card").count()) === 0);

// --- 10. second run in the same session ------------------------------------
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/beta.pdf`]);
await page.waitForFunction(() => document.querySelectorAll(".thumb-box canvas").length === 2, null, { timeout: 15000 });
await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
check("second merge works (buffers not detached)", (await page.locator("#doneMeta").textContent()).includes("5 pages"), await page.locator("#doneMeta").textContent());

// --- 11. focus visibility --------------------------------------------------
await page.locator("#restartBtn").click();
await page.waitForTimeout(150);
await page.keyboard.press("Tab");
const outline = await page.evaluate(() => {
  const el = document.activeElement;
  const s = getComputedStyle(el);
  return { tag: el.tagName, outline: s.outlineWidth + " " + s.outlineStyle };
});
check("focus ring visible on tab", outline.outline.includes("3px"), JSON.stringify(outline));

// --- 12. narrow viewport ---------------------------------------------------
await page.setViewportSize({ width: 375, height: 800 });
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/beta.pdf`]);
await page.waitForSelector("#workspace.on");
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("no horizontal overflow at 375px", overflow <= 0, "overflow " + overflow + "px");
const moveVisible = await page.evaluate(() => getComputedStyle(document.querySelector(".card .move")).display);
check("panel is bottom-docked at 375px", await page.evaluate(() => getComputedStyle(document.querySelector(".panel")).position) === "fixed");
await page.screenshot({ path: path.join(TMP, "mobile.png"), fullPage: true });
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(TMP, "desktop.png") });

// --- 13. landing page ------------------------------------------------------
await page.goto(BASE + "/index.html", { waitUntil: "networkidle" });
check("index.html links to merge", (await page.locator('a[href="merge.html"]').count()) >= 1);

check("no console errors", consoleErrors.length === 0, consoleErrors.join(" || "));

await browser.close();

console.log("artifacts in " + TMP);
console.log("\nPASS (" + pass.length + ")");
pass.forEach(p => console.log("  ✓ " + p));
if (fail.length) {
  console.log("\nFAIL (" + fail.length + ")");
  fail.forEach(f => console.log("  ✗ " + f));
  process.exit(1);
}
console.log("\nall green");
