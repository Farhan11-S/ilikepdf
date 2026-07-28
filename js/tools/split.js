/* Split PDF — pulls pages out of one document into one or more new ones.

   Three modes:
     range   — "1-4, 7, 9-12": each range becomes its own PDF
     extract — click pages to pick them; they become one PDF together
     every   — one PDF per page

   One output downloads as a PDF. More than one is zipped. */

import "../core/chrome.js";
import { isPdf } from "../core/store.js";
import * as thumbs from "../core/thumbs.js";
import { mountGrid } from "../core/grid.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { parseRanges, toIndices } from "../core/ranges.js";
import { fileSize, plural, baseName } from "../core/format.js";

const $ = id => document.getElementById(id);

const fileInput = $("fileInput");
const panel = mountPanel($("panel"));
const rangeInput = $("rangeInput");

let src = null;      // {name, size, bytes, pages}
let doc = null;      // pdf.js document, kept open for thumbnails
let mode = "range";
let picked = new Set();   // 0-based page indices, extract mode
let result = null;        // {blob, filename, count}
let note = "";            // sticky message about the file itself, not the settings
let pageItems = [];       // grid items: one per page of the loaded document
let owner = new Map();    // page index -> which output file it lands in
let ownerCount = 0;       // how many output files there are

const grid = mountGrid($("pageGrid"), {
  variant: "tile",
  items: () => pageItems,
  render: async item => thumbs.renderPage(await doc.getPage(item.id + 1)),
  onToggle(item){
    if(mode !== "extract") return;
    picked.has(item.id) ? picked.delete(item.id) : picked.add(item.id);
    update();
  },
  describe(item){
    const i = item.id;
    if(mode === "extract"){
      const on = picked.has(i);
      return { selected: on, clickable: true, tag: on ? "✓" : "",
               label: `Page ${i + 1}${on ? ", selected" : ""}` };
    }
    if(mode === "every"){
      return { selected: true, clickable: false, label: `Page ${i + 1}` };
    }
    // Range mode: tag pages with their output number, but only when there is
    // more than one output to tell apart.
    const inOutput = owner.has(i);
    return {
      selected: inOutput,
      clickable: false,
      tag: inOutput && ownerCount > 1 ? String(owner.get(i) + 1) : "",
      label: `Page ${i + 1}${inOutput ? ", included" : ", not included"}`
    };
  }
});

/* What the current settings would produce: one entry per output file. */
function plan(){
  if(!src) return { outputs: [], error: null };
  const base = baseName(src.name);

  if(mode === "every"){
    return {
      outputs: Array.from({ length: src.pages }, (_, i) => ({
        name: `${base}_page_${i + 1}.pdf`, indices: [i]
      })),
      error: null
    };
  }

  if(mode === "extract"){
    const indices = [...picked].sort((a, b) => a - b);
    return {
      outputs: indices.length ? [{ name: `${base}_extracted.pdf`, indices }] : [],
      error: null
    };
  }

  const { ranges, error } = parseRanges(rangeInput.value, src.pages);
  if(error) return { outputs: [], error };
  return {
    outputs: ranges.map(r => ({
      name: r.from === r.to ? `${base}_page_${r.from}.pdf` : `${base}_pages_${r.from}-${r.to}.pdf`,
      indices: toIndices(r)
    })),
    error: null
  };
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

/* Errors before a document is loaded belong on the hero — the panel isn't on
   screen yet, and opening an empty workspace just to show a message is worse. */
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

  picked = new Set();
  rangeInput.value = "1-" + src.pages;
  rangeInput.max = src.pages;
  note = pdfs.length > 1 ? `Split works on one PDF at a time — using ${src.name}.` : "";
  panel.setError(note);

  $("srcName").textContent = src.name;
  $("srcMeta").textContent = plural(src.pages, "page") + " · " + fileSize(src.size);
  pageItems = Array.from({ length: src.pages }, (_, i) => ({ id: i, label: String(i + 1) }));
  showWorkspace();
  grid.reset();
  grid.refresh();
  update();
}

/* ---------- mode switching ---------- */
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener("change", () => {
    mode = radio.value;
    document.querySelectorAll(".mode-body").forEach(b => {
      b.hidden = b.dataset.for !== mode;
    });
    update();
  });
});
rangeInput.addEventListener("input", update);
$("selectAll").onclick = () => {
  picked = new Set(Array.from({ length: src.pages }, (_, i) => i));
  update();
};
$("selectNone").onclick = () => { picked = new Set(); update(); };

/* ---------- keep the panel and the grid in step ---------- */
function update(){
  const { outputs, error } = plan();

  // Which output, if any, each page belongs to. describe() reads this.
  owner = new Map();
  outputs.forEach((o, n) => o.indices.forEach(i => { if(!owner.has(i)) owner.set(i, n); }));
  ownerCount = outputs.length;
  grid.paint();

  // A bad range replaces the note; a good one lets the note show again.
  panel.setError(error || note);
  if(error){
    panel.setSummary("");
    panel.setEnabled(false, "Split PDF");
    return;
  }

  const pageCount = outputs.reduce((n, o) => n + o.indices.length, 0);
  panel.setSummary(
    "Pages selected: <strong>" + (pageCount || "—") + "</strong><br>" +
    "Files created: <strong>" + (outputs.length || "—") + "</strong>" +
    (outputs.length > 1 ? " <span class='zip-note'>(zipped)</span>" : "")
  );

  const label = mode === "extract" && !outputs.length ? "Pick at least one page"
              : !outputs.length ? "Choose what to split"
              : outputs.length === 1 ? "Split PDF"
              : `Split into ${outputs.length} files`;
  panel.setEnabled(outputs.length > 0, label);
}

/* ---------- splitting ---------- */
panel.onAction(async () => {
  const { outputs } = plan();
  if(!outputs.length) return;

  panel.setBusy(true, "Splitting…");
  panel.setError("");
  try{
    const { PDFDocument } = PDFLib;
    // Load the source once and copy out of it repeatedly — reloading per output
    // would be the slow part of "every page" on a big document.
    const srcDoc = await PDFDocument.load(src.bytes.slice(), { ignoreEncryption: true });

    const built = [];
    for(let i = 0; i < outputs.length; i++){
      const out = await PDFDocument.create();
      const copied = await out.copyPages(srcDoc, outputs[i].indices);
      copied.forEach(p => out.addPage(p));
      built.push({ name: outputs[i].name, bytes: await out.save() });
      panel.setProgress((i + 1) / outputs.length);
      // Yield now and then so the progress bar actually paints.
      if(i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    if(built.length === 1){
      result = {
        blob: new Blob([built[0].bytes], { type: "application/pdf" }),
        filename: built[0].name,
        count: 1
      };
    }else{
      const zip = new JSZip();
      built.forEach(f => zip.file(f.name, f.bytes));
      result = {
        blob: await zip.generateAsync({ type: "blob" }),
        filename: baseName(src.name) + "_split.zip",
        count: built.length
      };
    }

    $("doneTitle").textContent = result.count === 1
      ? "Your PDF is ready"
      : `Your PDF has been split into ${result.count} files`;
    $("doneMeta").textContent =
      plural(result.count, "file") + " · " + fileSize(result.blob.size) +
      (result.count > 1 ? " · ZIP" : "");
    $("downloadBtn").textContent = result.count === 1 ? "Download PDF" : "Download ZIP";
    showDone();
  }catch(err){
    panel.setError("That PDF couldn't be split. It may be password-protected or damaged.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Split PDF");
    update();
  }
});

$("downloadBtn").onclick = () => downloadBlob(result.blob, result.filename);
$("restartBtn").onclick = () => {
  src = null; doc = null; result = null; picked = new Set(); note = ""; pageItems = [];
  grid.reset();
  panel.setError("");
  $("heroError").classList.remove("on");
  showHero();
};

showHero();
