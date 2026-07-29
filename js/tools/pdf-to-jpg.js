/* PDF to JPG — renders pages to images.

   pdf.js does all of it; pdf-lib is never loaded, because nothing here writes a
   PDF. The single-file-or-ZIP handling is split.js's, down to the button label:
   one image downloads as an image, several are zipped. */

import "../core/chrome.js";
import { inspect, isPdf } from "../core/store.js";
import * as thumbs from "../core/thumbs.js";
import { mountGrid } from "../core/grid.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { loadZip } from "../core/libs.js";
import { fileSize, plural, baseName } from "../core/format.js";

const $ = id => document.getElementById(id);

const fileInput = $("fileInput");
const panel = mountPanel($("panel"));

let src = null;      // {name, size, bytes, pages}
let doc = null;      // pdf.js document, kept open for thumbnails and rendering
let mode = "all";
let picked = new Set();   // 0-based page indices, pick mode
let pageItems = [];
let result = null;   // {blob, filename, count}
let note = "";

const grid = mountGrid($("pageGrid"), {
  variant: "tile",
  items: () => pageItems,
  render: async item => thumbs.renderPage(await doc.getPage(item.id + 1)),
  onToggle(item){
    if(mode !== "pick") return;
    picked.has(item.id) ? picked.delete(item.id) : picked.add(item.id);
    update();
  },
  describe(item){
    const i = item.id;
    if(mode === "pick"){
      const on = picked.has(i);
      return { selected: on, clickable: true, tag: on ? "✓" : "",
               label: `Page ${i + 1}${on ? ", selected" : ""}` };
    }
    return { selected: true, clickable: false, label: `Page ${i + 1}` };
  }
});

/* Which pages come out, in order. */
function chosen(){
  if(!src) return [];
  if(mode === "all") return pageItems.map(p => p.id);
  return [...picked].sort((a, b) => a - b);
}

function settings(){
  const format = $("formatSel").value;
  return {
    format,
    ext: format === "png" ? "png" : "jpg",
    mime: format === "png" ? "image/png" : "image/jpeg",
    scale: Number($("scaleSel").value),
    quality: Number($("qualityInput").value) / 100
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

  picked = new Set();
  note = [warning, pdfs.length > 1 ? `This works on one PDF at a time — using ${src.name}.` : ""]
    .filter(Boolean).join(" ");
  panel.setError(note);

  pageItems = Array.from({ length: src.pages }, (_, i) => ({ id: i, label: String(i + 1) }));
  $("srcName").textContent = src.name;
  $("srcMeta").textContent = plural(src.pages, "page") + " · " + fileSize(src.size);
  showWorkspace();
  grid.reset();
  grid.refresh();
  update();
}

/* ---------- controls ---------- */
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener("change", () => {
    mode = radio.value;
    document.querySelectorAll(".mode-body").forEach(b => { b.hidden = b.dataset.for !== mode; });
    update();
  });
});
["formatSel", "scaleSel", "qualityInput"].forEach(id => $(id).addEventListener("input", update));
$("selectAll").onclick = () => {
  picked = new Set(pageItems.map(p => p.id));
  update();
};
$("selectNone").onclick = () => { picked = new Set(); update(); };

function update(){
  const s = settings();
  grid.paint();

  $("qualityOut").textContent = Math.round(s.quality * 100);
  // PNG is lossless; a quality slider for it would be a lie.
  $("qualityWrap").hidden = s.format === "png";

  const n = chosen().length;
  panel.setSummary(
    "Images: <strong>" + (n || "—") + "</strong>" +
    (n > 1 ? " <span class='zip-note'>(zipped)</span>" : "") + "<br>" +
    "Size: <strong>" + s.scale + "×</strong> " + s.ext.toUpperCase()
  );

  const label = !n ? "Pick at least one page"
              : n === 1 ? `Convert to ${s.ext.toUpperCase()}`
              : `Convert ${n} pages`;
  panel.setEnabled(n > 0, label);
}

/* ---------- rendering ---------- */
async function renderToBlob(pageNumber, s){
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: s.scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  // JPEG has no alpha and a PDF page is paper: without this, anything the page
  // doesn't paint comes out black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise(r => canvas.toBlob(r, s.mime, s.quality));
}

panel.onAction(async () => {
  const indices = chosen();
  if(!indices.length) return;

  const s = settings();
  panel.setBusy(true, "Converting…");
  panel.setError("");
  try{
    const base = baseName(src.name);
    const built = [];
    for(let i = 0; i < indices.length; i++){
      built.push({
        name: `${base}_page_${indices[i] + 1}.${s.ext}`,
        blob: await renderToBlob(indices[i] + 1, s)
      });
      panel.setProgress((i + 1) / indices.length * (indices.length > 1 ? 0.85 : 1));
    }

    if(built.length === 1){
      result = { blob: built[0].blob, filename: built[0].name, count: 1 };
    }else{
      const JSZip = await loadZip();
      const zip = new JSZip();
      for(const f of built) zip.file(f.name, f.blob);
      result = {
        blob: await zip.generateAsync({ type: "blob" }),
        filename: `${base}_${s.ext}.zip`,
        count: built.length
      };
      panel.setProgress(1);
    }

    $("doneTitle").textContent = result.count === 1
      ? "Your image is ready"
      : `Your PDF is now ${result.count} images`;
    $("doneMeta").textContent =
      plural(result.count, "image") + " · " + fileSize(result.blob.size) +
      (result.count > 1 ? " · ZIP" : "");
    $("downloadBtn").textContent =
      result.count === 1 ? `Download ${s.ext.toUpperCase()}` : "Download ZIP";
    showDone();
  }catch(err){
    panel.setError("Those pages couldn't be converted. The PDF may be damaged.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Convert");
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
