/* Reading images in, and getting them into a PDF.

   Shared by watermark and JPG to PDF: both need the pixel dimensions before the
   user presses anything (to lay the page out and to preview it), and both hit
   the same pdf-lib limitation on the way out. */

/* Reads a File into {name, type, bytes, width, height, bitmap}.
   Rejects if the browser can't decode it — a .png that isn't one, mostly. */
export async function readImage(file){
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([bytes], { type: file.type || "image/png" }));
  return {
    name: file.name,
    type: /\.png$/i.test(file.name) || file.type === "image/png" ? "png" : "jpg",
    bytes,
    width: bitmap.width,
    height: bitmap.height,
    bitmap
  };
}

/* A canvas thumbnail, letterboxed into maxW × maxH. The grid renders these the
   same way it renders PDF pages. */
export function renderImage(img, maxW = 150, maxH = 190){
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(img.width * scale));
  canvas.height = Math.max(1, Math.floor(img.height * scale));
  canvas.getContext("2d").drawImage(img.bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/* Embeds an image into a pdf-lib document.

   pdf-lib's JPEG embedder hands the bytes straight to PDF's DCTDecode, which
   covers baseline JPEG and nothing else — a progressive or CMYK photo either
   throws here or produces a page no viewer can draw. The browser has already
   decoded it for the thumbnail, so re-encoding through a canvas costs one draw
   and always yields a baseline JPEG. */
export async function embedImage(pdfDoc, img){
  try{
    return img.type === "png"
      ? await pdfDoc.embedPng(img.bytes.slice())
      : await pdfDoc.embedJpg(img.bytes.slice());
  }catch(e){
    const bytes = await reencode(img);
    return pdfDoc.embedJpg(bytes);
  }
}

async function reencode(img){
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  // JPEG has no alpha, so anything transparent would come out black otherwise.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img.bitmap, 0, 0);
  const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}
