/* Merge PDF — combines every file in the list, in list order, into one document. */

import "../core/chrome.js";
import * as store from "../core/store.js";
import * as thumbs from "../core/thumbs.js";
import { mountGrid } from "../core/grid.js";
import { fileSize, plural } from "../core/format.js";
import { mountDropzone } from "../core/dropzone.js";
import { mountPanel } from "../core/panel.js";
import { downloadBlob } from "../core/download.js";
import { loadPdfLib } from "../core/libs.js";

const $ = id => document.getElementById(id);

const fileInput = $("fileInput");
const panel = mountPanel($("panel"));
let mergedBlob = null;

/* Files are cards: a thumbnail with the name and page count underneath.
   Array order is output order, so the order badge is the merge position. */
const grid = mountGrid($("grid"), {
  variant: "card",
  showOrder: true,
  items: () => store.list().map(f => ({
    id: f.id,
    label: f.name,
    meta: (f.pages === null ? "reading…" : plural(f.pages, "page")) + " · " + fileSize(f.size),
    thumb: f.thumb
  })),
  reorder: (from, to) => store.moveTo(from, to),   // notifies, which refreshes us
  onRemove: item => store.remove(item.id),
  // Touch devices get no drag, so they get buttons instead.
  controlsStyle: "row",
  controls: [
    { id: "left",  label: "←", title: "Move left",  onClick: item => store.shift(item.id, -1) },
    { id: "right", label: "→", title: "Move right", onClick: item => store.shift(item.id, 1) }
  ],
  onAdd: () => fileInput.click()
});

store.subscribe(() => grid.refresh());

mountDropzone({
  overlay: $("overlay"),
  hot: $("dropzone"),
  onFiles: intake
});

/* ---------- views ---------- */
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

/* Before any file is loaded the panel isn't on screen, so an error sent there
   is an error nobody sees. Same split the other tools use. */
function fail(msg){
  if(store.count()){
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

  const { added, notes } = await store.addFiles(fileList);
  if(!added.length){
    fail(notes.length ? notes.join(" ") : "Those files aren't PDFs. Add files ending in .pdf.");
    return;
  }
  panel.setError(notes.join(" "));
  showWorkspace();
  // Page counts and thumbnails arrive one by one; each repaints the grid.
  store.pending().forEach(entry => thumbs.hydrate(entry).then(store.notifyChange));
}

/* ---------- panel state ---------- */
store.subscribe(files => {
  const pages = files.reduce((n, f) => n + (f.pages || 0), 0);
  panel.setSummary(
    "Files selected: <strong>" + files.length + "</strong><br>" +
    "Pages in result: <strong>" + (pages || "—") + "</strong>"
  );
  const enough = files.length >= 2;
  panel.setEnabled(enough, enough ? "Merge PDF" : "Add one more PDF");
  if(!files.length) showHero();
});

/* ---------- merging ---------- */
panel.onAction(async () => {
  const files = store.list();
  panel.setBusy(true, "Merging…");
  panel.setError("");
  let reading = null;      // whichever file we're on, so a failure can name it
  try{
    const { PDFDocument } = await loadPdfLib();
    const out = await PDFDocument.create();
    for(let i = 0; i < files.length; i++){
      reading = files[i].name;
      // .slice() — pdf-lib detaches the buffer, and we may merge again.
      const src = await PDFDocument.load(files[i].bytes.slice(), { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach(p => out.addPage(p));
      panel.setProgress((i + 1) / files.length);
      // Let the progress bar paint between documents.
      await new Promise(r => setTimeout(r, 60));
    }
    const bytes = await out.save();
    mergedBlob = new Blob([bytes], { type: "application/pdf" });
    $("doneMeta").textContent =
      files.length + " files · " + out.getPageCount() + " pages · " + fileSize(mergedBlob.size);
    showDone();
  }catch(err){
    panel.setError(reading
      ? `"${reading}" couldn't be read. It may be password-protected or damaged — remove it and try again.`
      : "Something went wrong before the merge could start. Reload and try again.");
    console.error(err);
  }finally{
    panel.setBusy(false, "Merge PDF");
  }
});

$("downloadBtn").onclick = () => downloadBlob(mergedBlob, "ilikepdf_merged.pdf");
$("restartBtn").onclick = () => {
  mergedBlob = null;
  panel.setError("");
  $("heroError").classList.remove("on");
  store.clear();   // empties the list, which sends us back to the hero
};

showHero();
