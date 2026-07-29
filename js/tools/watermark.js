/* Watermark — lays text or an image over every page.

   Two things make this more than a drawImage call. Pages can carry their own
   /Rotate, so the geometry is done in the reader's view of the page and
   converted at the end (js/core/place.js). And a rotated mark is positioned by
   its centre, not by the corner pdf-lib draws from, so every placement is a
   centre point turned back into a draw origin. */

import "../core/chrome.js";
import { isImage, isPdf } from "../core/store.js";
import * as thumbs from "../core/thumbs.js";
import { readImage, embedImage } from "../core/images.js";
import { mountGrid, stampSpots } from "../core/grid.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { loadPdfLib } from "../core/libs.js";
import { fileSize, plural, baseName } from "../core/format.js";
import { widthOfText, heightOfText } from "../core/helvetica.js";
import { norm, toPageSpace, visualSize } from "../core/place.js";

const $ = id => document.getElementById(id);

const fileInput = $("fileInput");
const imageInput = $("imageInput");
const panel = mountPanel($("panel"));

let src = null;      // {name, size, bytes, pages}
let doc = null;      // pdf.js document, kept open for thumbnails
let pageItems = [];
let result = null;
let mode = "text";
let image = null;    // {name, type, bytes, width, height, bitmap}
let imageError = "";

/* The settings, normalised. Range inputs can't produce anything out of bounds,
   but the number fields can be emptied. */
function settings(){
  return {
    text: $("textInput").value.trim(),
    size: Math.min(300, Math.max(6, Number($("sizeInput").value) || 48)),
    colour: $("colourInput").value,
    opacity: Number($("opacityInput").value) / 100,
    angle: Number($("angleInput").value),
    scale: Number($("scaleInput").value) / 100,
    tiled: $("tiled").checked
  };
}

/* Is there anything to stamp? */
function ready(){
  const s = settings();
  return mode === "text" ? s.text.length > 0 : Boolean(image);
}

/* ---------- geometry ----------

   Everything below works in the page as the reader sees it. `mark` is the
   unrotated size of the thing being stamped; `bounds` is how much room it takes
   up once turned, which is what decides how many fit across the page. */

function markSize(vw){
  const s = settings();
  if(mode === "text"){
    // Measured from the same Helvetica metrics pdf-lib will use, so the number
    // of tiles previewed is the number of tiles drawn — see js/core/helvetica.js.
    return { w: widthOfText(s.text, s.size), h: heightOfText(s.size) };
  }
  const w = vw * s.scale;
  return { w, h: w * (image.height / image.width) };
}

/* A w×h box turned by `angle` needs this much room. */
function bounds(w, h, angle){
  const a = Math.abs(Math.cos(angle * Math.PI / 180));
  const b = Math.abs(Math.sin(angle * Math.PI / 180));
  return { w: w * a + h * b, h: w * b + h * a };
}

/* How many marks fit across a vw×vh page, with a little air between them. */
function tiling(vw, vh, mark, angle){
  const b = bounds(mark.w, mark.h, angle);
  return {
    cols: Math.max(1, Math.round(vw / (b.w * 1.15))),
    rows: Math.max(1, Math.round(vh / (b.h * 1.6)))
  };
}

/* Where to start drawing so the mark's centre lands on (cx, cy). pdf-lib draws
   from the bottom-left and rotates about that same point, so the offset to the
   centre has to be turned by the same angle before it's subtracted. */
function originFor(cx, cy, w, h, angle){
  const r = angle * Math.PI / 180;
  const dx = (w / 2) * Math.cos(r) - (h / 2) * Math.sin(r);
  const dy = (w / 2) * Math.sin(r) + (h / 2) * Math.cos(r);
  return { x: cx - dx, y: cy - dy };
}

/* The stamp descriptor the grid previews, using the first page's shape.
   Thumbnails are all one document, so one shape is enough. */
function previewStamp(){
  if(!ready() || !src) return null;
  const s = settings();
  const v = { w: src.width, h: src.height };
  const mark = markSize(v.w);
  return {
    text: mode === "text" ? s.text : baseName(image.name),
    anchor: "c",
    angle: s.angle,
    tiled: s.tiled ? tiling(v.w, v.h, mark, s.angle) : null
  };
}

const grid = mountGrid($("pageGrid"), {
  variant: "tile",
  items: () => pageItems,
  render: async item => thumbs.renderPage(await doc.getPage(item.id + 1)),
  describe: item => ({ caption: String(item.id + 1), stamp: previewStamp() })
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
  const files = [...fileList];

  // Once a document is open, a dropped image is the watermark rather than a
  // mistake — it's the only other file this tool takes.
  if(src && !files.some(isPdf) && files.some(isImage)){
    await useImage(files.find(isImage));
    return;
  }

  const pdfs = files.filter(isPdf);
  if(!pdfs.length){
    fail("That isn't a PDF. Choose a file ending in .pdf.");
    return;
  }
  const file = pdfs[0];
  try{
    const bytes = new Uint8Array(await file.arrayBuffer());
    doc = await thumbs.open(bytes);
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    src = { name: file.name, size: file.size, bytes, pages: doc.numPages,
            width: first.width, height: first.height };
  }catch(e){
    fail(`"${file.name}" couldn't be opened. It may be password-protected or damaged.`);
    console.error(e);
    return;
  }

  pageItems = Array.from({ length: src.pages }, (_, i) => ({ id: i, label: String(i + 1) }));
  panel.setError(pdfs.length > 1 ? `Watermark works on one PDF at a time — using ${src.name}.` : "");

  $("srcName").textContent = src.name;
  $("srcMeta").textContent = plural(src.pages, "page") + " · " + fileSize(src.size);
  showWorkspace();
  grid.reset();
  grid.refresh();
  update();
}

/* ---------- the watermark image ---------- */
$("imagePick").onclick = () => imageInput.click();
imageInput.onchange = e => {
  const file = e.target.files[0];
  imageInput.value = "";
  if(file) useImage(file);
};

async function useImage(file){
  imageError = "";
  if(!isImage(file)){
    imageError = `"${file.name}" isn't a PNG or JPG.`;
    image = null;
  }else{
    try{
      image = await readImage(file);
    }catch(err){
      image = null;
      imageError = `"${file.name}" couldn't be read as an image.`;
      console.error(err);
    }
  }
  if(image){
    // Choosing an image is only meaningful in image mode; go there.
    document.querySelector('input[name="mode"][value="image"]').checked = true;
    setMode("image");
  }
  update();
}

/* ---------- controls ---------- */
function setMode(next){
  mode = next;
  document.querySelectorAll(".mode-body").forEach(b => { b.hidden = b.dataset.for !== mode; });
  update();
}
document.querySelectorAll('input[name="mode"]').forEach(radio => {
  radio.addEventListener("change", () => setMode(radio.value));
});

["textInput", "sizeInput", "colourInput", "opacityInput", "angleInput", "scaleInput", "tiled"]
  .forEach(id => $(id).addEventListener("input", update));

function update(){
  const s = settings();
  $("opacityOut").textContent = Math.round(s.opacity * 100);
  $("angleOut").textContent = s.angle;
  $("scaleOut").textContent = Math.round(s.scale * 100);
  $("imageName").textContent = image
    ? `${image.name} · ${image.width}×${image.height}`
    : "PNG or JPG. Nothing is uploaded.";

  grid.paint();
  panel.setError(imageError);

  if(!src) return;

  const marks = ready()
    ? stampSpots(previewStamp()).length * pageItems.length
    : 0;
  panel.setSummary(
    "Marks per page: <strong>" + (marks ? marks / pageItems.length : "—") + "</strong><br>" +
    "Pages covered: <strong>" + (marks ? pageItems.length : "—") + "</strong>"
  );

  const label = ready() ? "Add watermark"
              : mode === "text" ? "Type some text first"
              : "Choose an image first";
  panel.setEnabled(ready(), label);
}

/* ---------- export ---------- */
panel.onAction(async () => {
  panel.setBusy(true, "Watermarking…");
  panel.setError("");
  try{
    const { PDFDocument, StandardFonts, degrees, rgb } = await loadPdfLib();
    const s = settings();
    const out = await PDFDocument.load(src.bytes.slice(), { ignoreEncryption: true });

    const font = mode === "text" ? await out.embedFont(StandardFonts.Helvetica) : null;
    const embedded = mode === "image" ? await embedImage(out, image) : null;
    const colour = hexToRgb(s.colour, rgb);

    const pages = out.getPages();
    pages.forEach((page, i) => {
      const { width, height } = page.getSize();
      const angle = norm(page.getRotation().angle);
      const v = visualSize(width, height, angle);

      const mark = markSize(v.w);
      const spots = stampSpots({
        text: "x", anchor: "c", angle: s.angle,
        tiled: s.tiled ? tiling(v.w, v.h, mark, s.angle) : null
      });

      for(const [fx, fy] of spots){
        // Centre of this mark, in the reader's view of the page.
        const o = originFor(fx * v.w, fy * v.h, mark.w, mark.h, s.angle);
        const p = toPageSpace(o.x, o.y, width, height, angle);
        // The page's own rotation plus the angle the user asked for: the first
        // cancels what the viewer will do, the second is what they see.
        const rotate = degrees(norm(angle + s.angle));

        if(mode === "text"){
          page.drawText(s.text, {
            x: p.x, y: p.y, size: s.size, font,
            color: colour, opacity: s.opacity, rotate
          });
        }else{
          page.drawImage(embedded, {
            x: p.x, y: p.y, width: mark.w, height: mark.h,
            opacity: s.opacity, rotate
          });
        }
      }
      if(i % 16 === 15) panel.setProgress(i / pages.length * 0.9);
    });
    panel.setProgress(0.95);

    const bytes = await out.save();
    result = {
      blob: new Blob([bytes], { type: "application/pdf" }),
      filename: baseName(src.name) + "_watermarked.pdf"
    };
    panel.setProgress(1);

    $("doneMeta").textContent =
      plural(pages.length, "page") + " marked · " + fileSize(result.blob.size);
    showDone();
  }catch(err){
    panel.setError("That PDF couldn't be watermarked. It may be password-protected or damaged.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Add watermark");
    update();
  }
});

function hexToRgb(hex, rgb){
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

$("downloadBtn").onclick = () => downloadBlob(result.blob, result.filename);
$("restartBtn").onclick = () => {
  src = null; doc = null; result = null; pageItems = []; image = null; imageError = "";
  grid.reset();
  panel.setError("");
  $("heroError").classList.remove("on");
  showHero();
};

update();
showHero();
