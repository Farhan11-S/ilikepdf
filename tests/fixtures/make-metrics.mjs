/* Regenerates the table in js/core/helvetica.js from pdf-lib itself, so the two
 * cannot drift. Run from the repo root with a server up:
 *
 *   python3 -m http.server 8000 &
 *   node tests/fixtures/make-metrics.mjs
 *
 * It prints; it doesn't write. Paste the numbers in and check the diff.
 */
import { launch, BASE } from "../harness.mjs";

const { browser, page } = await launch();
await page.goto(BASE + "/watermark.html", { waitUntil: "networkidle" });

const m = await page.evaluate(async () => {
  const { PDFDocument, StandardFonts } = await window.ilikepdf.loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const widths = [];
  for(let c = 32; c <= 126; c++){
    widths.push(Math.round(font.widthOfTextAtSize(String.fromCharCode(c), 1000)));
  }
  return { widths, height: font.heightAtSize(1000) };
});

console.log("HEIGHT =", m.height);
for(let i = 0; i < m.widths.length; i += 16){
  console.log("  " + m.widths.slice(i, i + 16).join(",") + ",");
}
await browser.close();
