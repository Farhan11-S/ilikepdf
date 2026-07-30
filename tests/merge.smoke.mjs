/* Merge PDF smoke test. See tests/harness.mjs for how to run it. */
import fs from "node:fs";
import path from "node:path";
import { launch, suite, BASE, FIX, TMP } from "./harness.mjs";

const { check, report } = suite("merge");
const { browser, page, errors: consoleErrors } = await launch();

await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });

// --- 1. initial view -------------------------------------------------------
check("hero visible on load", await page.locator("#hero").isVisible());
check("workspace hidden on load", !(await page.locator("#workspace").isVisible()));
check("action button starts disabled", await page.locator(".btn-action").isDisabled());
check("header and footer are injected",
  (await page.locator(".site-header .logo").count()) === 1 &&
  (await page.locator(".site-footer .privacy").count()) === 1);

// The hero view has to survive a narrow screen too, not just the workspace.
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(200);
check("hero has no horizontal overflow at 375px", await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0);
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(200);

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
await page.evaluate(() => document.querySelectorAll(".card")[0].querySelector('[data-action="right"]').click());
check("move-right swaps first two", (await names()).join(",") === "beta.pdf,alpha.pdf,gamma.pdf", (await names()).join(","));
await page.evaluate(() => document.querySelectorAll(".card")[1].querySelector('[data-action="left"]').click());
check("move-left restores order", (await names()).join(",") === "alpha.pdf,beta.pdf,gamma.pdf");
await page.evaluate(() => document.querySelectorAll(".card")[0].querySelector('[data-action="left"]').click());
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
check("non-PDF shows error in the panel",
  (await page.locator(".panel .error").isVisible())
  && (await page.locator(".panel .error").textContent()).includes("aren't PDFs"));
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
  const pdfjsLib = await window.ilikepdf.loadPdfJs();
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

// --- 11b. errors before a file is loaded ----------------------------------
/* The panel isn't on screen yet, so an error sent there is invisible. */
await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", [`${FIX}/notes.txt`]);
await page.waitForTimeout(250);
check("a non-PDF is reported on the hero when nothing is loaded",
  (await page.locator("#heroError").isVisible())
  && (await page.locator("#heroError").textContent()).includes("aren't PDFs"));
check("and the hero is still the thing on screen", await page.locator("#hero").isVisible());

/* An empty file is not the same problem as a corrupt one, and saying so saves
   someone hunting for a password that was never set. */
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([], "empty.pdf", { type: "application/pdf" }));
  document.getElementById("fileInput").files = dt.files;
  document.getElementById("fileInput").dispatchEvent(new Event("change"));
});
await page.waitForTimeout(250);
check("an empty PDF says it's empty, and names it",
  (await page.locator("#heroError").textContent()).includes("empty.pdf")
  && (await page.locator("#heroError").textContent()).includes("empty"),
  await page.locator("#heroError").textContent());

// --- 11c. keyboard reordering ----------------------------------------------
/* Drag is mouse-only and the ← → buttons only appear under hover:none, so
   without this the grid cannot be reordered from a keyboard at all. */
await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/beta.pdf`, `${FIX}/gamma.pdf`]);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".card").length === 3);
check("a reorderable card is a tab stop",
  await page.evaluate(() => document.querySelector(".card").tabIndex === 0));
check("and says how to move it",
  (await page.locator(".card").first().getAttribute("aria-label")).includes("arrow keys"),
  await page.locator(".card").first().getAttribute("aria-label"));

await page.locator(".card").first().focus();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
check("arrow right moves the focused card along",
  (await names()).join(",") === "beta.pdf,alpha.pdf,gamma.pdf", (await names()).join(","));
check("focus follows the card it moved", await page.evaluate(() =>
  document.activeElement.classList.contains("card")
  && document.activeElement.querySelector(".name").textContent === "alpha.pdf"),
  await page.evaluate(() => document.activeElement.textContent));

await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(150);
check("arrow left moves it back",
  (await names()).join(",") === "alpha.pdf,beta.pdf,gamma.pdf", (await names()).join(","));
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(150);
check("arrow left at the start does nothing",
  (await names()).join(",") === "alpha.pdf,beta.pdf,gamma.pdf");

/* A refresh the user didn't ask for must not cost them their place. Thumbnails
   hydrate one by one and each one repaints the whole grid (merge.js), so
   without this the three checks above only pass when hydration happens to have
   finished first — which is why they were intermittent against source and
   green against the inlined build. Adding a file forces the same rebuild on
   demand, so this reproduces it without waiting on a race. */
// Scoped to the focused card itself: querying the document would happily
// return the first card's name when focus has actually fallen to <body>.
const focusedName = () => page.evaluate(() => {
  const card = document.activeElement?.closest?.(".card");
  return card ? card.querySelector(".name").textContent : "(focus lost)";
});
await page.locator(".card").first().focus();
await page.setInputFiles("#fileInput", `${FIX}/onepage.pdf`);
await page.waitForFunction(() => document.querySelectorAll(".card").length === 4);
check("a background rebuild keeps focus where it was",
  (await focusedName()) === "alpha.pdf", await focusedName());
await page.waitForFunction(() =>
  ![...document.querySelectorAll(".card .meta")].some(m => m.textContent.includes("reading…")));
check("and still keeps it once thumbnails have hydrated",
  (await focusedName()) === "alpha.pdf", await focusedName());

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

// --- 13. a PDF with form fields says so ------------------------------------
/* Same defect as split's §12 and organize's §12. Merge's twist is that the flag
   arrives from hydration, one file at a time and after intake has already
   painted — so the message cannot be written once at intake and left alone. */
await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/form.pdf`]);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".thumb-box canvas").length === 2,
  null, { timeout: 15000 });

const mergeMsg = () => page.locator(".panel .error").textContent().then(t => t.trim());
await page.waitForFunction(() => /form fields/i.test(document.querySelector(".panel .error").textContent),
  null, { timeout: 15000 }).catch(() => {});
const formMsg = await mergeMsg();
check("a PDF with form fields is called out", /form fields/i.test(formMsg), JSON.stringify(formMsg));
check("the warning names the file", formMsg.includes("form.pdf"));
check("the warning doesn't block the merge", !(await page.locator(".btn-action").isDisabled()));

const formFields = async bytes => page.evaluate(async arr => {
  const pdfjsLib = await window.ilikepdf.loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
  const f = await doc.getFieldObjects();
  return f ? Object.keys(f).length : 0;
}, [...bytes]);

check("the fixture really has fields to lose", (await formFields(fs.readFileSync(`${FIX}/form.pdf`))) > 0);

await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
const [dl] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("#downloadBtn").click()
]);
const mergedPath = path.join(TMP, dl.suggestedFilename());
await dl.saveAs(mergedPath);
const mergedBytes = fs.readFileSync(mergedPath);
check("the warning is true — the merged output has no form left",
  (await formFields(mergedBytes)) === 0);

// Removing the offending file must take the warning with it.
await page.locator("#restartBtn").click();
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/beta.pdf`]);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".thumb-box canvas").length === 2,
  null, { timeout: 15000 });
const plainMsg = await mergeMsg();
check("ordinary PDFs get no form warning", !/form fields/i.test(plainMsg), JSON.stringify(plainMsg));

// --- 14. a signed PDF in the list ------------------------------------------
await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/signed.pdf`]);
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => /digitally signed/i.test(document.querySelector(".panel .error").textContent),
  null, { timeout: 15000 }).catch(() => {});
const mergeSig = (await page.locator(".panel .error").textContent()).trim();
check("a signed PDF is called out", /digitally signed/i.test(mergeSig), JSON.stringify(mergeSig));
check("and is not accused of having form fields", !/form fields/i.test(mergeSig));
check("the warning doesn't block the merge", !(await page.locator(".btn-action").isDisabled()));

// --- 15. a file the preview can't read is still merged, and said so --------
/* pdf-lib is more forgiving than pdf.js, so merge can and does merge files the
   other six tools refuse — found by the phase 10 sweep on an encrypted PDF.
   That is worth keeping; what wasn't is that the card read "0 pages" and the
   summary promised a total the export then exceeded.

   `encrypted.pdf` is the real thing rather than a simulation: 2.7 KB, copied
   from mozilla/pdf.js's test corpus as encrypted-attachment.pdf (its URL and
   hash are in tests/real-corpus.json). pdf.js refuses it and pdf-lib merges it,
   which is exactly the split this tests. Patching pdf.js was tried first and
   cannot work — getDocument is a non-configurable getter, so the assignment
   silently does nothing and the test passes for the wrong reason. */
const blindNoise = consoleErrors.length;
await page.goto(BASE + "/merge.html", { waitUntil: "networkidle" });
await page.setInputFiles("#fileInput", [`${FIX}/alpha.pdf`, `${FIX}/encrypted.pdf`]);   // 3 pages + 1
await page.waitForSelector("#workspace.on");
await page.waitForFunction(() => document.querySelectorAll(".card").length === 2);
await page.waitForFunction(() =>
  [...document.querySelectorAll(".card .meta")].some(m => m.textContent.includes("can't preview")),
  null, { timeout: 15000 });

const blindMetas = await page.locator(".card .meta").allTextContents();
check("an unreadable file says so instead of '0 pages'",
  blindMetas.some(m => m.includes("can't preview")) && !blindMetas.some(m => m.startsWith("0 pages")),
  JSON.stringify(blindMetas));

const blindSummary = (await page.locator(".summary").textContent()).replace(/\s+/g, " ");
check("the page total is marked as a floor, not a count",
  blindSummary.includes("3+"), blindSummary);
check("and says how many it couldn't see", /1 not previewed/.test(blindSummary), blindSummary);
check("the panel explains it will still be merged",
  /still be merged/i.test(await page.locator(".panel .error").textContent()));

await page.locator(".btn-action").click();
await page.waitForSelector("#done.on", { timeout: 20000 });
const [blindDl] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("#downloadBtn").click()
]);
const blindPath = path.join(TMP, "blind-" + blindDl.suggestedFilename());
await blindDl.saveAs(blindPath);
/* Page count alone would only prove a page *arrived*. pdf-lib's
   ignoreEncryption does not decrypt anything — it just declines to throw — so
   the content is the part worth asserting: without this, a merge that emitted a
   blank or garbled page would pass. */
const blindOut = await page.evaluate(async arr => {
  const pdfjsLib = await window.ilikepdf.loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise;
  const last = await doc.getPage(doc.numPages);
  return {
    pages: doc.numPages,
    text: (await last.getTextContent()).items.map(x => x.str).join("").trim(),
    ops: (await last.getOperatorList()).fnArray.length
  };
}, [...fs.readFileSync(blindPath)]);
check("the file we couldn't preview really is in the output", blindOut.pages === 4, blindOut.pages + " pages");
check("and its page has content, not just a page count",
  blindOut.text.includes("Example") && blindOut.ops > 0,
  `text="${blindOut.text}" ops=${blindOut.ops}`);
// pdf.js failing to open it logs; that's the condition under test.
consoleErrors.length = blindNoise;

check("no console errors", consoleErrors.length === 0, consoleErrors.join(" || "));

await browser.close();
report();
