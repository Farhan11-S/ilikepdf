/* Page numbers — stamps a number onto every page.

   The whole tool is one setting bundle applied uniformly, so unlike rotate there
   is no per-page state: the grid is a preview, not an input. What makes it more
   than a loop is the pages that carry their own /Rotate — see js/core/place.js
   for why "bottom-right" is not a fixed pair of coordinates. */

import "../core/chrome.js";
import { inspect, isPdf } from "../core/store.js";
import * as thumbs from "../core/thumbs.js";
import { mountGrid } from "../core/grid.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { loadPdfLib } from "../core/libs.js";
import { inspectFields, signedWarning } from "../core/forms.js";
import { fileSize, plural, baseName } from "../core/format.js";
import { ANCHORS, anchorPoint, norm, toPageSpace, uprightAngle, visualSize } from "../core/place.js";

const $ = id => document.getElementById(id);

const fileInput = $("fileInput");
const panel = mountPanel($("panel"));

let src = null;       // {name, size, bytes, pages}
let doc = null;       // pdf.js document, kept open for thumbnails
let pageItems = [];
let result = null;
let anchor = "br";

const ANCHOR_TITLES = {
  tl: "Top left",    tc: "Top centre",    tr: "Top right",
  bl: "Bottom left", bc: "Bottom centre", br: "Bottom right"
};

/* What page `i` (0-based) will say, or "" if it isn't numbered. */
function labelFor(i){
  if(!src) return "";
  if($("skipFirst").checked && i === 0) return "";
  const start = Number($("startInput").value);
  const n = start + i;
  const last = start + src.pages - 1;
  switch($("formatSel").value){
    case "word": return "Page " + n;
    case "ofn":  return n + " of " + last;
    default:     return String(n);
  }
}

const numbered = () => pageItems.filter(item => labelFor(item.id) !== "").length;

const grid = mountGrid($("pageGrid"), {
  variant: "tile",
  items: () => pageItems,
  render: async item => thumbs.renderPage(await doc.getPage(item.id + 1)),
  describe: item => {
    const text = labelFor(item.id);
    // Same treatment as split: "selected" means "in the result", the grid dims
    // what isn't, and a skipped first page reads as left out at a glance.
    return {
      selected: text !== "",
      // The marker follows the reader's view of the page, so on a page that
      // arrives quarter-turned it sits where the number will actually appear.
      stamp: text ? { text, anchor } : null
    };
  }
});

/* ---------- position picker ---------- */
$("anchorPick").innerHTML = ANCHORS.map(a =>
  `<button type="button" role="radio" data-anchor="${a}"
           aria-checked="${a === anchor}" aria-label="${ANCHOR_TITLES[a]}"
           title="${ANCHOR_TITLES[a]}"><i></i></button>`).join("");

$("anchorPick").addEventListener("click", e => {
  const btn = e.target.closest("[data-anchor]");
  if(!btn) return;
  anchor = btn.dataset.anchor;
  [...$("anchorPick").children].forEach(b =>
    b.setAttribute("aria-checked", b.dataset.anchor === anchor));
  update();
});

/* ---------- view ---------- */
function view(hero, workspace, done){
  $("hero").style.display = hero ? "block" : "none";
  $("workspace").classList.toggle("on", workspace);
  $("done").classList.toggle("on", done);
}
const showHero      = () => view(true, false, false);
const showWorkspace = () => view(false, true, false);
const showDone      = () => view(false, false, true);

/* ---------- file intake ---------- */
$("pickBtn").onclick = () => fileInput.click();
fileInput.onchange = e => { intake(e.target.files); fileInput.value = ""; };
mountDropzone({ overlay: $("overlay"), hot: $("dropzone"), onFiles: intake });

function fail(msg){
  if(src){
    panel.setError(msg);
    showWorkspace();
  }else{
    const el = $("heroError");
    el.textContent = msg;
    el.classList.add("on");
    showHero();
  }
}

async function intake(fileList){
  $("heroError").classList.remove("on");

  const pdfs = [...fileList].filter(isPdf);
  if(!pdfs.length){
    fail("That isn't a PDF. Choose a file ending in .pdf.");
    return;
  }
  const file = pdfs[0];
  const { error, warning } = inspect(file);
  if(error){
    fail(error);
    return;
  }
  try{
    const bytes = new Uint8Array(await file.arrayBuffer());
    doc = await thumbs.open(bytes);
    src = { name: file.name, size: file.size, bytes, pages: doc.numPages };
  }catch(e){
    fail(`"${file.name}" couldn't be opened. It may be password-protected or damaged.`);
    console.error(e);
    return;
  }

  pageItems = Array.from({ length: src.pages }, (_, i) => ({ id: i, label: String(i + 1) }));
  // Stamping is an in-place edit, so the form survives — but no signature does.
  const { signed } = await inspectFields(doc);
  panel.setError([warning,
                  signed ? signedWarning([src.name], "given page numbers") : "",
                  pdfs.length > 1 ? `Page numbers work on one PDF at a time — using ${src.name}.` : ""]
    .filter(Boolean).join(" "));

  $("srcName").textContent = src.name;
  $("srcMeta").textContent = plural(src.pages, "page") + " · " + fileSize(src.size);
  showWorkspace();
  grid.reset();
  grid.refresh();
  update();
}

/* ---------- controls ---------- */
["formatSel", "sizeInput", "marginInput", "startInput", "skipFirst"]
  .forEach(id => $(id).addEventListener("input", update));

function settings(){
  return {
    size: Math.min(72, Math.max(5, Number($("sizeInput").value) || 11)),
    margin: Math.min(200, Math.max(0, Number($("marginInput").value) || 0))
  };
}

function update(){
  grid.paint();

  const n = numbered();
  panel.setSummary(
    "Pages numbered: <strong>" + (n || "—") + "</strong>" +
    (n && n !== pageItems.length ? " of " + pageItems.length : "") + "<br>" +
    "Result: <strong>1</strong> PDF"
  );
  panel.setEnabled(n > 0, n ? "Add page numbers" : "Nothing left to number");
}

/* ---------- export ---------- */
panel.onAction(async () => {
  panel.setBusy(true, "Numbering…");
  panel.setError("");
  try{
    const { PDFDocument, StandardFonts, rgb, degrees } = await loadPdfLib();
    const { size, margin } = settings();
    const out = await PDFDocument.load(src.bytes.slice(), { ignoreEncryption: true });
    const font = await out.embedFont(StandardFonts.Helvetica);

    const pages = out.getPages();
    pages.forEach((page, i) => {
      const text = labelFor(i);
      if(!text) return;

      const { width, height } = page.getSize();
      const angle = norm(page.getRotation().angle);
      const v = visualSize(width, height, angle);

      // Lay the text out as the reader sees it, then convert. The baseline sits
      // a little above the box's bottom edge, which is what descenders need.
      const tw = font.widthOfTextAtSize(text, size);
      const th = font.heightAtSize(size);
      const spot = anchorPoint(anchor, v.w, v.h, tw, th, margin);
      const { x, y } = toPageSpace(spot.x, spot.y, width, height, angle);

      page.drawText(text, {
        x, y, size, font,
        color: rgb(0.2, 0.2, 0.24),
        rotate: degrees(uprightAngle(angle))
      });
      if(i % 24 === 23) panel.setProgress(i / pages.length * 0.9);
    });
    panel.setProgress(0.95);

    const bytes = await out.save();
    result = {
      blob: new Blob([bytes], { type: "application/pdf" }),
      filename: baseName(src.name) + "_numbered.pdf"
    };
    panel.setProgress(1);

    $("doneMeta").textContent =
      plural(numbered(), "page") + " numbered · " + fileSize(result.blob.size);
    showDone();
  }catch(err){
    panel.setError("That PDF couldn't be numbered. It may be password-protected or damaged.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Add page numbers");
    update();
  }
});

$("downloadBtn").onclick = () => downloadBlob(result.blob, result.filename);
$("restartBtn").onclick = () => {
  src = null; doc = null; result = null; pageItems = [];
  grid.reset();
  panel.setError("");
  $("heroError").classList.remove("on");
  showHero();
};

showHero();
