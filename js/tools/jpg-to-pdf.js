/* JPG to PDF — one image per page, in the order you drag them.

   The only tool that never touches pdf.js: there is no PDF to preview, so
   thumbnails come from createImageBitmap and pdf-lib is loaded at Export and
   nowhere else. It also keeps its own list rather than using store.js, which
   only knows about PDFs — addFiles filters on isPdf and callers hydrate through
   pdf.js. Otherwise this is organize.js: a local array whose order is the
   output order, drag to reorder, ✕ to remove. */

import "../core/chrome.js";
import { isImage } from "../core/store.js";
import { readImage, renderImage, embedImage } from "../core/images.js";
import { mountGrid } from "../core/grid.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { loadPdfLib } from "../core/libs.js";
import { fileSize, plural, baseName } from "../core/format.js";

const $ = id => document.getElementById(id);

/* Points, at 72 per inch. */
const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

const fileInput = $("fileInput");
const panel = mountPanel($("panel"));

let images = [];     // {id, ...readImage()} — order is page order
let result = null;
let uid = 0;

const grid = mountGrid($("pageGrid"), {
  variant: "tile",
  showOrder: true,
  items: () => images,
  render: async item => renderImage(item),
  describe: item => ({ caption: `${item.width}×${item.height}` }),
  reorder(from, to){
    const [moved] = images.splice(from, 1);
    images.splice(to, 0, moved);
    grid.refresh();
    update();
  },
  onRemove(item){
    images = images.filter(i => i.id !== item.id);
    grid.refresh();
    update();
  },
  // No HTML5 drag on touch devices, so they get buttons — same as merge.
  controlsStyle: "row",
  controls: [
    { id: "left",  label: "←", title: "Move left",  onClick: (item, i) => nudge(i, -1) },
    { id: "right", label: "→", title: "Move right", onClick: (item, i) => nudge(i, 1) }
  ],
  onAdd: () => fileInput.click(),
  addLabel: "Add more images",
  placeholder: "🖼️"
});

function nudge(i, dir){
  const j = i + dir;
  if(j < 0 || j >= images.length) return;
  [images[i], images[j]] = [images[j], images[i]];
  grid.refresh();
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
$("addBtn").onclick = () => fileInput.click();
fileInput.onchange = e => { intake(e.target.files); fileInput.value = ""; };
mountDropzone({ overlay: $("overlay"), hot: $("dropzone"), onFiles: intake });

function fail(msg){
  if(images.length){
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

  const files = [...fileList];
  const pics = files.filter(isImage);
  if(!pics.length){
    fail("Those aren't images. Choose JPG or PNG files.");
    return;
  }

  const broken = [];
  for(const file of pics){
    try{
      images.push({ id: ++uid, ...await readImage(file) });
    }catch(err){
      broken.push(file.name);
      console.error(err);
    }
  }

  if(!images.length){
    fail(`"${broken.join('", "')}" couldn't be read as an image.`);
    return;
  }

  const skipped = [...broken, ...files.filter(f => !isImage(f)).map(f => f.name)];
  panel.setError(skipped.length ? `Skipped ${skipped.join(", ")} — not a readable JPG or PNG.` : "");

  showWorkspace();
  grid.refresh();
  update();
}

/* ---------- controls ---------- */
["sizeSel", "marginInput", "autoRotate"].forEach(id => $(id).addEventListener("input", update));
$("clearBtn").onclick = () => {
  images = [];
  grid.reset();
  panel.setError("");
  update();
  showHero();
};

function settings(){
  return {
    size: $("sizeSel").value,
    margin: Math.min(200, Math.max(0, Number($("marginInput").value) || 0)),
    autoRotate: $("autoRotate").checked
  };
}

/* The page each image lands on, and where the image sits within it. Fit mode
   makes the page the image's own size, so there is nothing to letterbox. */
function layout(img, s){
  if(s.size === "fit"){
    const w = img.width + s.margin * 2;
    const h = img.height + s.margin * 2;
    return { pageW: w, pageH: h, x: s.margin, y: s.margin, w: img.width, h: img.height };
  }

  let [pageW, pageH] = SIZES[s.size];
  // A landscape photo on a portrait page wastes half the sheet; turn the page.
  if(s.autoRotate && img.width > img.height) [pageW, pageH] = [pageH, pageW];

  const boxW = Math.max(1, pageW - s.margin * 2);
  const boxH = Math.max(1, pageH - s.margin * 2);
  const scale = Math.min(boxW / img.width, boxH / img.height);
  const w = img.width * scale, h = img.height * scale;
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

function update(){
  const s = settings();
  $("sizeHint").textContent = s.size === "fit"
    ? "Each page is exactly the size of its image."
    : "Images are centred and scaled to fit the page.";
  // Nothing to turn when the page is cut to the image.
  $("autoRotate").closest(".check-line").hidden = s.size === "fit";

  $("srcName").textContent = images.length === 1 ? images[0].name : plural(images.length, "image");
  $("srcMeta").textContent = images.length
    ? fileSize(images.reduce((n, i) => n + i.bytes.length, 0))
    : "";

  panel.setSummary(
    "Images: <strong>" + (images.length || "—") + "</strong><br>" +
    "Pages in result: <strong>" + (images.length || "—") + "</strong>"
  );
  $("clearBtn").disabled = !images.length;
  panel.setEnabled(images.length > 0, images.length ? "Convert to PDF" : "Add an image first");
  if(!images.length) showHero();
}

/* ---------- export ---------- */
panel.onAction(async () => {
  panel.setBusy(true, "Converting…");
  panel.setError("");
  try{
    const { PDFDocument } = await loadPdfLib();
    const s = settings();
    const out = await PDFDocument.create();

    for(let i = 0; i < images.length; i++){
      const img = images[i];
      const embedded = await embedImage(out, img);
      const box = layout(img, s);
      const page = out.addPage([box.pageW, box.pageH]);
      page.drawImage(embedded, { x: box.x, y: box.y, width: box.w, height: box.h });
      panel.setProgress((i + 1) / images.length * 0.9);
      // Let the progress bar paint between images; they can be large.
      if(i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }

    const bytes = await out.save();
    result = {
      blob: new Blob([bytes], { type: "application/pdf" }),
      filename: (images.length === 1 ? baseName(images[0].name) : "ilikepdf_images") + ".pdf"
    };
    panel.setProgress(1);

    $("doneMeta").textContent =
      plural(images.length, "page") + " · " + fileSize(result.blob.size);
    showDone();
  }catch(err){
    panel.setError("Those images couldn't be turned into a PDF. One of them may be damaged.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Convert to PDF");
    update();
  }
});

$("downloadBtn").onclick = () => downloadBlob(result.blob, result.filename);
$("restartBtn").onclick = () => {
  images = []; result = null;
  grid.reset();
  panel.setError("");
  $("heroError").classList.remove("on");
  update();
  showHero();
};

update();
showHero();
