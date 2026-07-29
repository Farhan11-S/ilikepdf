/* Copies the four library files we ship into vendor/.
 *
 *   npm run vendor
 *
 * The versions are pinned in package.json (exact, no range), so package-lock.json
 * is the real pin and this script is just a copy. Sources are node_modules, not a
 * CDN: the site must work from a fresh clone with no network, and a CDN that is
 * blocked or slow would take every tool down with it.
 *
 * vendor/ is committed. Re-run this after changing a version in package.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "vendor");

const FILES = [
  ["pdf-lib/dist/pdf-lib.min.js",        "pdf-lib.min.js"],
  ["pdfjs-dist/build/pdf.min.js",        "pdf.min.js"],
  ["pdfjs-dist/build/pdf.worker.min.js", "pdf.worker.min.js"],
  ["jszip/dist/jszip.min.js",            "jszip.min.js"]
];

fs.mkdirSync(OUT, { recursive: true });

for(const [from, to] of FILES){
  const src = path.join(ROOT, "node_modules", from);
  if(!fs.existsSync(src)){
    console.error(`missing ${from} — run npm install first`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(OUT, to));
  console.log(`${to.padEnd(20)} ${(fs.statSync(src).size / 1024).toFixed(0)} KB`);
}
