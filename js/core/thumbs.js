/* pdf.js setup and first-page rendering. Preview only — pdf-lib does all writing. */

const WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* A cross-origin worker can be refused, so fetch the worker source and hand
   pdf.js a same-origin blob URL instead. Fall back to the raw URL if that fails. */
const ready = (async function init(){
  try{
    const res = await fetch(WORKER_URL);
    const code = await res.text();
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  }catch(e){
    pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_URL;
  }
})();

export function whenReady(){ return ready; }

/* pdf.js detaches the buffer it is given, so callers always pass a copy. */
export async function open(bytes){
  await ready;
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

/* Fills in `pages` and `thumb` on a store entry. A file we cannot read gets
   pages 0 rather than staying null, so the UI stops saying "reading…". */
export async function hydrate(entry){
  try{
    const doc = await open(entry.bytes);
    entry.pages = doc.numPages;
    entry.thumb = await renderPage(await doc.getPage(1));
  }catch(e){
    entry.pages = entry.pages || 0;
  }
  return entry;
}
