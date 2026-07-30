/* pdf.js setup and first-page rendering. Preview only — pdf-lib does all writing. */

import { loadPdfJs } from "./libs.js";
import { hasForm } from "./forms.js";

/* pdf.js detaches the buffer it is given, so callers always pass a copy. */
export async function open(bytes){
  const pdfjsLib = await loadPdfJs();
  return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
}

export async function renderPage(page, maxW = 150, maxH = 190){
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxW / base.width, maxH / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
  return canvas;
}

/* Fills in `pages`, `thumb` and `form` on a store entry. A file we cannot read
   gets pages 0 rather than staying null, so the UI stops saying "reading…".
   `form` rides along here because the document is already open — merge has no
   other reason to parse it, and reopening every file just to ask would double
   the cost of adding one. */
export async function hydrate(entry){
  try{
    const doc = await open(entry.bytes);
    entry.pages = doc.numPages;
    entry.form = await hasForm(doc);
    entry.thumb = await renderPage(await doc.getPage(1));
  }catch(e){
    entry.pages = entry.pages || 0;
  }
  return entry;
}
