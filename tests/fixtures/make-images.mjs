/* Regenerates the image fixtures. Run from the repo root with a server up:
 *
 *   python3 -m http.server 8000 &
 *   node tests/fixtures/make-images.mjs
 *
 * They are drawn in the browser rather than written by hand because a real
 * baseline JPEG is not something to hand-assemble, and the labels make it
 * obvious in a screenshot which fixture ended up on a page.
 */
import { launch, BASE } from "../harness.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { browser, page } = await launch();
await page.goto(BASE + "/index.html");

const files = await page.evaluate(async () => {
  const draw = (w, h, hue) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue},70%,55%)`); g.addColorStop(1, `hsl(${hue + 60},70%,40%)`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "#fff"; x.font = `bold ${Math.round(h / 3)}px sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(`${w}x${h}`, w / 2, h / 2);
    return c;
  };
  const grab = (c, type, q) => new Promise(r => c.toBlob(async b =>
    r(Array.from(new Uint8Array(await b.arrayBuffer()))), type, q));
  return {
    "logo.png": await grab(draw(240, 120, 350), "image/png"),
    "wide.jpg": await grab(draw(400, 200, 200), "image/jpeg", 0.9),
    "tall.jpg": await grab(draw(200, 400, 90), "image/jpeg", 0.9)
  };
});

for(const [name, bytes] of Object.entries(files)){
  fs.writeFileSync(path.join(HERE, name), Buffer.from(bytes));
  console.log("wrote", name, bytes.length, "bytes");
}
await browser.close();
