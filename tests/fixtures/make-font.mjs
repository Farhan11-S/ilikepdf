/* Regenerates tiny.ttf — the custom-watermark-font fixture. From the repo root:
 *
 *   node tests/fixtures/make-font.mjs
 *
 * A real TrueType font, built here rather than copied in, for the same reason
 * make-signed.mjs builds its own signature: a fixture we author has no licence
 * to reason about, stays about 1 KB, and is reproducible from source.
 *
 * It carries exactly what the watermark test needs:
 *   - "A" and "B", so it can draw something Helvetica could draw too;
 *   - U+65E5 (日), which Helvetica *cannot* encode — the whole point of 12.2;
 *   - deliberately no glyph for U+65E6, so the missing-glyph path has something
 *     to catch. A font that covered everything could not test that.
 *
 * Every glyph is the same rectangle. What is under test is the embedding and
 * the metrics agreeing with the preview, not the shapes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const UPM = 1000, ADV = 600, ASC = 800, DESC = -200;
const BOX = { xMin: 50, yMin: 0, xMax: 550, yMax: 700 };
// glyph 0 is .notdef by convention; the rest are the mapped characters.
const CHARS = ["A", "B", "日"];
const N = CHARS.length + 1;

const u8 = n => { const b = Buffer.alloc(1); b.writeUInt8(n & 0xff); return b; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; };
const i16 = n => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const cat = (...parts) => Buffer.concat(parts.flat());
const pad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

/* One closed contour of four on-curve points. Flags are 0x01: on-curve, with x
   and y written as int16 deltas rather than the short forms. */
function boxGlyph(){
  const xs = [BOX.xMin, BOX.xMax, BOX.xMax, BOX.xMin];
  const ys = [BOX.yMin, BOX.yMin, BOX.yMax, BOX.yMax];
  const dx = xs.map((x, i) => x - (i ? xs[i - 1] : 0));
  const dy = ys.map((y, i) => y - (i ? ys[i - 1] : 0));
  return cat(
    i16(1),                                        // numberOfContours
    i16(BOX.xMin), i16(BOX.yMin), i16(BOX.xMax), i16(BOX.yMax),
    u16(3),                                        // endPtsOfContours
    u16(0),                                        // no instructions
    xs.map(() => u8(0x01)),                        // flags
    dx.map(i16), dy.map(i16)
  );
}

/* glyf + loca. .notdef is empty (zero-length), which is legal and is how a font
   says "nothing to draw" without a shape. */
const glyphs = [Buffer.alloc(0), ...CHARS.map(() => pad4(boxGlyph()))];
const glyf = cat(glyphs);
const offsets = [];
let at = 0;
for(const g of glyphs){ offsets.push(at); at += g.length; }
offsets.push(at);
const loca = cat(offsets.map(u32));               // long format, per head below

/* cmap format 4, one segment per character plus the mandatory 0xFFFF sentinel.
   Segments are single characters, so idDelta carries the whole mapping and
   idRangeOffset stays 0 throughout. */
function cmap(){
  const points = CHARS.map((c, i) => ({ code: c.codePointAt(0), gid: i + 1 }))
    .sort((a, b) => a.code - b.code);
  const segs = [...points.map(p => ({ start: p.code, end: p.code, delta: (p.gid - p.code) & 0xffff })),
                { start: 0xffff, end: 0xffff, delta: 1 }];
  const segX2 = segs.length * 2;
  const sub = cat(
    u16(4), u16(16 + segs.length * 8), u16(0),
    u16(segX2),
    u16(2 * Math.pow(2, Math.floor(Math.log2(segs.length)))),   // searchRange
    u16(Math.floor(Math.log2(segs.length))),                    // entrySelector
    u16(segX2 - 2 * Math.pow(2, Math.floor(Math.log2(segs.length)))),
    segs.map(s => u16(s.end)), u16(0),
    segs.map(s => u16(s.start)),
    segs.map(s => i16(s.delta << 16 >> 16)),
    segs.map(() => u16(0))
  );
  return cat(u16(0), u16(1), u16(3), u16(1), u32(12), sub);
}

/* name: the PostScript name (id 6) is the one pdf-lib actually reads. */
function name(){
  const strings = [[1, "IlikePDF Tiny"], [2, "Regular"], [4, "IlikePDF Tiny"], [6, "IlikePDFTiny"]];
  const encoded = strings.map(([id, s]) => ({ id, buf: Buffer.from(s, "utf16le").swap16() }));
  let off = 0;
  const records = encoded.map(({ id, buf }) => {
    const r = cat(u16(3), u16(1), u16(0x0409), u16(id), u16(buf.length), u16(off));
    off += buf.length;
    return r;
  });
  return cat(u16(0), u16(encoded.length), u16(6 + encoded.length * 12),
             records, encoded.map(e => e.buf));
}

const tables = {
  head: cat(u32(0x00010000), u32(0x00010000), u32(0), u32(0x5F0F3CF5), u16(0),
            u16(UPM), Buffer.alloc(16), i16(BOX.xMin), i16(DESC), i16(BOX.xMax), i16(ASC),
            u16(0), u16(8), i16(2), i16(1), i16(0)),          // indexToLocFormat 1 = long
  hhea: cat(u32(0x00010000), i16(ASC), i16(DESC), i16(0), u16(ADV),
            i16(0), i16(0), i16(BOX.xMax), i16(1), i16(0), i16(0),
            Buffer.alloc(8), i16(0), u16(N)),
  maxp: cat(u32(0x00010000), u16(N), u16(4), u16(1), u16(0), u16(0), u16(2),
            u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0), u16(0)),
  hmtx: cat(Array.from({ length: N }, () => cat(u16(ADV), i16(BOX.xMin)))),
  cmap: cmap(),
  loca,
  glyf,
  name: name(),
  post: cat(u32(0x00030000), u32(0), i16(0), i16(0), u32(0), u32(0), u32(0), u32(0), u32(0)),
  "OS/2": cat(u16(4), i16(ADV), u16(400), u16(5), u16(0), i16(0), i16(0), i16(0), i16(0),
              i16(0), i16(0), i16(0), i16(0), i16(0), i16(0), Buffer.alloc(10),
              Buffer.from("NONE"), u16(0), u16(0), u16(0), Buffer.from("ILPF"),
              u32(1), u32(0), u32(0), u32(0), i16(ASC), i16(DESC), i16(0),
              u16(ASC), u16(-DESC), u32(0), u32(0), u16(0), u16(1), u16(1),
              i16(0), i16(0), u16(0))
};

/* Table directory, tags in ascending order as the spec requires. */
const tags = Object.keys(tables).sort();
const headerLen = 12 + tags.length * 16;
let cursor = headerLen;
const dir = [], body = [];
for(const tag of tags){
  const buf = pad4(tables[tag]);
  dir.push(cat(Buffer.from(tag.padEnd(4)), u32(0), u32(cursor), u32(tables[tag].length)));
  body.push(buf);
  cursor += buf.length;
}
const pow = Math.pow(2, Math.floor(Math.log2(tags.length)));
const font = cat(
  u32(0x00010000), u16(tags.length), u16(pow * 16),
  u16(Math.floor(Math.log2(tags.length))), u16(tags.length * 16 - pow * 16),
  dir, body
);

fs.writeFileSync(path.join(HERE, "tiny.ttf"), font);
console.log(`wrote tiny.ttf ${font.length} bytes, ${N} glyphs, maps ${CHARS.join(" ")}`);
