/* Rotate PDF — turns pages a quarter at a time, all together or one by one.

   `turns[i]` is how far the user has turned page i, on top of whatever rotation
   the page already carried. Thumbnails preview it with a CSS transform; the
   export adds it to the page's existing /Rotate. */

import "../core/chrome.js";
import { isPdf } from "../core/store.js";
import * as thumbs from "../core/thumbs.js";
import { mountPageGrid } from "../core/pagegrid.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { fileSize, plural, baseName } from "../core/format.js";

const $ = id => document.getElementById(id);

const fileInput = $("fileInput");
const panel = mountPanel($("panel"));

let src = null;      // {name, size, bytes, pages}
let doc = null;      // pdf.js document, kept open for thumbnails
let turns = [];      // per page: 0, 90, 180 or 270
let result = null;

const grid = mountPageGrid($("pageGrid"), {
  controls: [
    { id: "left",  label: "↺", title: "Rotate left",  onClick: i => turn(i, -90) },
    { id: "right", label: "↻", title: "Rotate right", onClick: i => turn(i, 90) }
  ]
});

const norm = deg => ((deg % 360) + 360) % 360;

function turn(i, by){
  turns[i] = norm(turns[i] + by);
  update();
}

function turnAll(by){
  turns = turns.map(t => norm(t + by));
  update();
}

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
  try{
    const bytes = new Uint8Array(await file.arrayBuffer());
    doc = await thumbs.open(bytes);
    src = { name: file.name, size: file.size, bytes, pages: doc.numPages };
  }catch(e){
    fail(`"${file.name}" couldn't be opened. It may be password-protected or damaged.`);
    console.error(e);
    return;
  }

  turns = new Array(src.pages).fill(0);
  panel.setError(pdfs.length > 1 ? `Rotate works on one PDF at a time — using ${src.name}.` : "");

  $("srcName").textContent = src.name;
  $("srcMeta").textContent = plural(src.pages, "page") + " · " + fileSize(src.size);
  showWorkspace();
  grid.load(doc);
  update();
}

/* ---------- controls ---------- */
$("allLeft").onclick = () => turnAll(-90);
$("allRight").onclick = () => turnAll(90);
$("resetBtn").onclick = () => { turns = turns.map(() => 0); update(); };

function update(){
  grid.setDescribe(i => ({
    selected: turns[i] !== 0,
    clickable: false,
    rotate: turns[i],
    caption: turns[i] ? `${i + 1} · ${turns[i]}°` : String(i + 1)
  }));

  const changed = turns.filter(Boolean).length;
  panel.setSummary(
    "Pages turned: <strong>" + (changed || "—") + "</strong>" +
    (changed ? " of " + turns.length : "") + "<br>" +
    "Result: <strong>1</strong> PDF"
  );
  $("resetBtn").disabled = !changed;
  panel.setEnabled(changed > 0, changed ? "Rotate PDF" : "Turn a page first");
}

/* ---------- export ---------- */
panel.onAction(async () => {
  panel.setBusy(true, "Rotating…");
  panel.setError("");
  try{
    const { PDFDocument, degrees } = PDFLib;
    const out = await PDFDocument.load(src.bytes.slice(), { ignoreEncryption: true });

    // Add to what's already there — a page can arrive with a /Rotate of its own,
    // and the thumbnail we turned was already showing that rotation applied.
    out.getPages().forEach((page, i) => {
      page.setRotation(degrees(norm(page.getRotation().angle + turns[i])));
    });
    panel.setProgress(0.7);

    const bytes = await out.save();
    result = {
      blob: new Blob([bytes], { type: "application/pdf" }),
      filename: baseName(src.name) + "_rotated.pdf"
    };
    panel.setProgress(1);

    const changed = turns.filter(Boolean).length;
    $("doneMeta").textContent =
      plural(changed, "page") + " turned · " + fileSize(result.blob.size);
    showDone();
  }catch(err){
    panel.setError("That PDF couldn't be rotated. It may be password-protected or damaged.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Rotate PDF");
    update();
  }
});

$("downloadBtn").onclick = () => downloadBlob(result.blob, result.filename);
$("restartBtn").onclick = () => {
  src = null; doc = null; result = null; turns = [];
  grid.load(null);
  panel.setError("");
  $("heroError").classList.remove("on");
  showHero();
};

showHero();
