/* Loads the three vendored libraries on demand.

   They used to be three blocking <script> tags in every page's <head> region —
   roughly half a megabyte of JavaScript parsed before anything could be drawn,
   for a page whose first useful act is "pick a file". pdf-lib is only needed at
   Export, JSZip only when the result is more than one file, and pdf.js only
   once there is a document to draw thumbnails of.

   They stay classic scripts exposing globals on purpose. The UMD builds are what
   the vendored files are, and the browser smoke tests read results back through
   `pdfjsLib` and `JSZip` inside page.evaluate — module-scoping them would mean
   rewriting every readback helper for no gain.

   Paths are relative and un-hashed here. The build rewrites them to hashed
   filenames; keeping them literal and stable is what makes that a string
   replace. Relative also means a copy of the site in a subfolder still works. */

import { busy, idle } from "./busy.js";

const cache = new Map();   // src -> Promise<global>

function inject(src, globalName, label){
  if(cache.has(src)) return cache.get(src);

  const p = new Promise((resolve, reject) => {
    busy(label);
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => {
      idle();
      const g = window[globalName];
      g ? resolve(g)
        : reject(new Error(`${src} loaded but ${globalName} is missing`));
    };
    s.onerror = () => {
      idle();
      // A failed load is not retried by the browser, and a cached rejected
      // promise would make every later attempt fail too. Let the next call try.
      cache.delete(src);
      reject(new Error("Couldn't load the PDF engine — check your connection and reload."));
    };
    document.head.appendChild(s);
  });

  cache.set(src, p);
  return p;
}

export function loadPdfLib(){
  return inject("vendor/pdf-lib.min.js", "PDFLib", "Loading the PDF engine…");
}

export async function loadPdfJs(){
  const lib = await inject("vendor/pdf.min.js", "pdfjsLib", "Loading the PDF viewer…");
  // Relative, so pdf.js resolves it against the document URL — which is what
  // lets the site live in a subfolder. Same-origin, so no blob-URL dance.
  if(!lib.GlobalWorkerOptions.workerSrc){
    lib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }
  return lib;
}

export function loadZip(){
  return inject("vendor/jszip.min.js", "JSZip", "Loading the ZIP writer…");
}

/* The biggest thing here, and the only one nothing loads by default: it is
   fetched when someone picks their own watermark font and never otherwise. */
export function loadFontkit(){
  return inject("vendor/fontkit.min.js", "fontkit", "Loading the font reader…");
}

/* The tests need to await a library before reaching for its global, and so does
   anything else driving the page from outside. */
window.ilikepdf = { loadPdfLib, loadPdfJs, loadZip, loadFontkit };
