/* Organize pages — one working set of pages gathered from any number of PDFs.
   Drag to reorder, ✕ to delete, undo to take it back.

   `pages` is the working set and its order is the output order. Sources are kept
   whole (bytes for pdf-lib, an open pdf.js document for thumbnails) because a
   page is only ever a reference into one of them. */

import "../core/chrome.js";
import { inspect, isPdf } from "../core/store.js";
import * as thumbs from "../core/thumbs.js";
import { mountGrid } from "../core/grid.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { loadPdfLib } from "../core/libs.js";
import { inspectFields, formWarning, signedWarning } from "../core/forms.js";
import { fileSize, plural, baseName } from "../core/format.js";

const $ = id => document.getElementById(id);

const UNDO_DEPTH = 60;

const fileInput = $("fileInput");
const panel = mountPanel($("panel"));

let sources = [];    // {name, size, bytes, doc, form}
let pages = [];      // {id, src, page} — the working set, in output order
let history = [];    // past states of `pages`, most recent last
let result = null;
let uid = 0;

const grid = mountGrid($("pageGrid"), {
  variant: "tile",
  showOrder: true,
  items: () => pages,
  render: async item => thumbs.renderPage(await sources[item.src].doc.getPage(item.page + 1)),
  describe: item => ({
    caption: String(item.page + 1),
    // Which file a page came from only matters once there's more than one.
    tag: sources.length > 1 ? String(item.src + 1) : ""
  }),
  onReorderStart: remember,
  reorder(from, to){
    const [moved] = pages.splice(from, 1);
    pages.splice(to, 0, moved);
    grid.refresh();
    update();
  },
  onRemove(item){
    remember();
    pages = pages.filter(p => p.id !== item.id);
    grid.refresh();
    update();
  },
  // Touch devices get no HTML5 drag, so they get buttons instead — same
  // fallback merge uses for its file cards.
  controlsStyle: "row",
  controls: [
    { id: "left",  label: "←", title: "Move left",  onClick: (item, i) => nudge(i, -1) },
    { id: "right", label: "→", title: "Move right", onClick: (item, i) => nudge(i, 1) }
  ],
  onAdd: () => fileInput.click(),
  addLabel: "Add more PDFs"
});

function nudge(i, dir){
  const j = i + dir;
  if(j < 0 || j >= pages.length) return;
  remember();
  [pages[i], pages[j]] = [pages[j], pages[i]];
  grid.refresh();
  update();
}

function remember(){
  history.push(pages.slice());
  if(history.length > UNDO_DEPTH) history.shift();
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
  if(sources.length){
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
    fail("Those files aren't PDFs. Choose files ending in .pdf.");
    return;
  }

  const broken = [];
  const notes = [];
  const adding = sources.length > 0;
  if(adding) remember();   // adding pages is undoable too

  for(const file of pdfs){
    const { error, warning } = inspect(file);
    if(error){ notes.push(error); continue; }
    if(warning) notes.push(warning);
    try{
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await thumbs.open(bytes);
      const src = sources.length;
      sources.push({ name: file.name, size: file.size, bytes, doc, ...await inspectFields(doc) });
      for(let p = 0; p < doc.numPages; p++){
        pages.push({ id: ++uid, src, page: p });
      }
    }catch(e){
      broken.push(file.name);
      console.error(e);
    }
  }

  if(!sources.length){
    if(adding) history.pop();
    fail(broken.length
      ? `"${broken.join('", "')}" couldn't be opened. It may be password-protected or damaged.`
      : notes.join(" "));
    return;
  }

  // Every source, not just this batch: a form-bearing file added first must
  // keep warning after a plain one is added on top of it.
  const named = flag => sources.filter(s => s[flag]).map(s => s.name);
  const withForms = named("form"), withSigs = named("signed");
  panel.setError([
    broken.length ? `Skipped ${broken.join(", ")} — password-protected or damaged.` : "",
    withSigs.length ? signedWarning(withSigs, "reorganised") : "",
    withForms.length ? formWarning(withForms, "reorganised") : "",
    ...notes
  ].filter(Boolean).join(" "));

  showWorkspace();
  grid.refresh();
  update();
}

/* ---------- controls ---------- */
$("undoBtn").onclick = () => {
  if(!history.length) return;
  pages = history.pop();
  grid.refresh();
  update();
};

$("resetBtn").onclick = () => {
  remember();
  pages = sources.flatMap((s, src) =>
    Array.from({ length: s.doc.numPages }, (_, page) => ({ id: ++uid, src, page })));
  grid.refresh();
  update();
};

function update(){
  const head = sources.length === 1
    ? sources[0].name
    : plural(sources.length, "file");
  $("srcName").textContent = head;
  $("srcMeta").textContent = plural(pages.length, "page") +
    (sources.length > 1 ? " · " + fileSize(sources.reduce((n, s) => n + s.size, 0)) : "");

  // A legend, so the number badge on each tile means something.
  $("legend").innerHTML = sources.length > 1
    ? sources.map((s, i) => `<span class="legend-item"><b>${i + 1}</b>${s.name}</span>`).join("")
    : "";

  const removed = sources.reduce((n, s) => n + s.doc.numPages, 0) - pages.length;
  panel.setSummary(
    "Pages kept: <strong>" + (pages.length || "—") + "</strong><br>" +
    (removed > 0 ? "Pages removed: <strong>" + removed + "</strong>" : "Result: <strong>1</strong> PDF")
  );

  $("undoBtn").disabled = !history.length;
  $("resetBtn").disabled = !sources.length;
  panel.setEnabled(pages.length > 0, pages.length ? "Save PDF" : "Keep at least one page");
}

/* ---------- export ---------- */
panel.onAction(async () => {
  panel.setBusy(true, "Saving…");
  panel.setError("");
  try{
    const { PDFDocument } = await loadPdfLib();
    const out = await PDFDocument.create();

    // Copy in one pass per source rather than one per page: copyPages builds a
    // copier each call, and a working set can easily be hundreds of pages.
    const wanted = new Map();          // src -> [page indices, first use first]
    for(const p of pages){
      if(!wanted.has(p.src)) wanted.set(p.src, []);
      const list = wanted.get(p.src);
      if(!list.includes(p.page)) list.push(p.page);
    }

    const copies = new Map();          // "src:page" -> copied page
    let done = 0;
    for(const [src, indices] of wanted){
      const srcDoc = await PDFDocument.load(sources[src].bytes.slice(), { ignoreEncryption: true });
      const copied = await out.copyPages(srcDoc, indices);
      indices.forEach((pageIndex, k) => copies.set(`${src}:${pageIndex}`, copied[k]));
      panel.setProgress(++done / wanted.size * 0.9);
    }

    for(const p of pages) out.addPage(copies.get(`${p.src}:${p.page}`));
    panel.setProgress(1);

    const bytes = await out.save();
    result = {
      blob: new Blob([bytes], { type: "application/pdf" }),
      filename: (sources.length === 1 ? baseName(sources[0].name) : "ilikepdf") + "_organized.pdf"
    };

    $("doneMeta").textContent =
      plural(pages.length, "page") + " · " + fileSize(result.blob.size);
    showDone();
  }catch(err){
    panel.setError("Those pages couldn't be saved. One of the files may be damaged.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Save PDF");
    update();
  }
});

$("downloadBtn").onclick = () => downloadBlob(result.blob, result.filename);
$("restartBtn").onclick = () => {
  sources = []; pages = []; history = []; result = null;
  grid.reset();
  panel.setError("");
  $("heroError").classList.remove("on");
  showHero();
};

showHero();
