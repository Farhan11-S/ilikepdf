/* Reading and checking the /Sig field of a PDF, for the signature tests.
   Dev tooling — not shipped.

   `tests/fixtures/signed.pdf` stores a SHA-256 of its own /ByteRange in
   /Contents instead of a CMS blob (see make-signed.mjs for why). verify()
   recomputes that digest, which answers the only question the suites ask: did
   an export leave the signature intact?

   The signature dictionary is located through pdf-lib rather than by scanning
   the file for "/ByteRange". That distinction is load-bearing: pdf-lib saves
   with object streams by default, so after any in-place tool the signature is
   still there but *compressed*, and a byte scan reports it missing. Getting
   this wrong inverts the finding — it makes rotate look like it removes the
   signature when what it really does is leave one that no longer verifies. */
import { PDFDocument, PDFName } from "pdf-lib";
import crypto from "node:crypto";

/* The first signature's /ByteRange and /Contents, or null if there is none. */
export async function readSignature(bytes){
  const buf = Buffer.from(bytes);
  let doc;
  try{ doc = await PDFDocument.load(buf.subarray(), { ignoreEncryption: true }); }
  catch{ return null; }

  let sig = null;
  try{
    sig = doc.getForm().getFields().find(f => f.constructor.name === "PDFSignature");
  }catch{ return null; }
  if(!sig) return null;

  const v = sig.acroField.dict.lookup(PDFName.of("V"));
  if(!v || !v.lookup) return null;

  const br = v.lookup(PDFName.of("ByteRange"));
  const contents = v.lookup(PDFName.of("Contents"));
  if(!br || !contents) return null;

  const nums = br.asArray().map(n => n.asNumber());
  // PDFHexString prints as <hex>; the trailing zero padding is placeholder.
  const hex = contents.toString().replace(/^<|>$/g, "").replace(/0+$/, "");
  return { name: sig.getName(), byteRange: nums, contents: hex };
}

/* Does the file still hash to what its signature claims? Anything that rewrites
   the document moves bytes, so this goes false the moment a tool saves. */
export async function verifySignature(bytes){
  const sig = await readSignature(bytes);
  if(!sig) return { present: false, valid: false, why: "no signature field in the document" };

  const buf = Buffer.from(bytes);
  const [a, b, c, d] = sig.byteRange;
  if(a + b > buf.length || c + d > buf.length){
    return { present: true, valid: false,
             why: `/ByteRange covers ${c + d} bytes of a ${buf.length}-byte file` };
  }
  const digest = crypto.createHash("sha256")
    .update(buf.subarray(a, a + b))
    .update(buf.subarray(c, c + d))
    .digest("hex");
  return digest === sig.contents
    ? { present: true, valid: true,  why: "digest matches the bytes /ByteRange covers" }
    : { present: true, valid: false, why: "digest does not match the bytes /ByteRange covers" };
}
