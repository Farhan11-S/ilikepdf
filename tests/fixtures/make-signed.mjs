/* Regenerates signed.pdf — the digital-signature fixture. Run from the repo root:
 *
 *   node tests/fixtures/make-signed.mjs
 *
 * A real AcroForm /Sig field: /ByteRange covering the whole file either side of
 * the /Contents hex string, exactly as a signed PDF is laid out. What sits in
 * /Contents is a SHA-256 of the covered bytes rather than a CMS blob — no
 * certificate, no crypto dependency.
 *
 * That is deliberate and sufficient, because the thing under test is whether
 * *our* tools destroy a signature, not whether we can validate one. The digest
 * gives a checkable integrity property with nothing to install: recompute it
 * over /ByteRange and compare (see verifySignature() in signed-check.mjs usage
 * inside the suites). A real CMS signature would prove the same thing and need
 * a certificate chain to do it.
 *
 * The honest limit, recorded in NEXT.md 10.7: this proves detection and
 * destruction. It cannot tell you what Acrobat says about a real signature —
 * that still needs one genuinely signed real-world file.
 */
import { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFArray, StandardFonts } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIG_BYTES = 2048;                  // placeholder /Contents size, in bytes

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const ctx = doc.context;

const page = doc.addPage([595, 842]);
page.drawText("Signed document — page 1", { x: 60, y: 780, size: 16, font });
page.drawText("This page carries an AcroForm /Sig field.", { x: 60, y: 750, size: 11, font });
const page2 = doc.addPage([595, 842]);
page2.drawText("Signed document — page 2", { x: 60, y: 780, size: 16, font });

/* /ByteRange has to be patched after saving, so it is emitted at full width —
   four 10-digit numbers — and the real values are written back over it padded
   with spaces. Anything shorter would not have room for the offsets. */
const byteRange = PDFArray.withContext(ctx);
for(let i = 0; i < 4; i++) byteRange.push(PDFNumber.of(9999999999));

const contents = PDFHexString.of("0".repeat(SIG_BYTES * 2));

const sigRef = ctx.register(ctx.obj({
  Type: "Sig",
  Filter: "Adobe.PPKLite",
  SubFilter: "adbe.pkcs7.detached",
  ByteRange: byteRange,
  Contents: contents,
  Name: PDFString.of("IlikePDF structural fixture"),
  Reason: PDFString.of("Not a real signature — digest stand-in, see make-signed.mjs"),
  M: PDFString.of("D:20260730120000Z")
}));

const widgetRef = ctx.register(ctx.obj({
  Type: "Annot",
  Subtype: "Widget",
  FT: "Sig",
  T: PDFString.of("Signature1"),
  Rect: [60, 640, 300, 700],
  V: sigRef,
  F: 4,
  P: page.ref
}));
page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));

doc.catalog.set(PDFName.of("AcroForm"), ctx.register(ctx.obj({
  SigFlags: 3,
  Fields: [widgetRef]
})));

// Object streams would bury /Contents where a byte-offset patch can't find it.
let bytes = Buffer.from(await doc.save({ useObjectStreams: false }));

/* Patch /ByteRange to the real offsets, then write the digest of exactly those
   bytes into /Contents — the same two-pass dance a real signer performs. */
const lt = bytes.indexOf("/Contents <") + "/Contents ".length;   // the '<'
const gt = bytes.indexOf(">", lt);                               // the '>'
const a = 0, b = lt, c = gt + 1, d = bytes.length - c;

const brStart = bytes.indexOf("/ByteRange [");
const brEnd = bytes.indexOf("]", brStart) + 1;
const replacement = `/ByteRange [${a} ${b} ${c} ${d}]`;
if(replacement.length > brEnd - brStart) throw new Error("ByteRange placeholder too small");
bytes.write(replacement.padEnd(brEnd - brStart, " "), brStart, "latin1");

const digest = crypto.createHash("sha256")
  .update(bytes.subarray(a, a + b))
  .update(bytes.subarray(c, c + d))
  .digest("hex");
bytes.write(digest.padEnd(SIG_BYTES * 2, "0"), lt + 1, "latin1");

fs.writeFileSync(path.join(HERE, "signed.pdf"), bytes);
console.log(`wrote signed.pdf ${bytes.length} bytes, ${doc.getPageCount()} pages`);
console.log(`  /ByteRange [${a} ${b} ${c} ${d}]  digest ${digest.slice(0, 32)}…`);
