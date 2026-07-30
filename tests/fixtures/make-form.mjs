/* Regenerates form.pdf — the AcroForm fixture. Run from the repo root:
 *
 *   node tests/fixtures/make-form.mjs
 *
 * Built with pdf-lib's own form API rather than committed as a binary from
 * some real-world file: it stays small, it stays reproducible, and it uses the
 * exact library version the site ships, so what it proves about copyPages is
 * about our pdf-lib and not somebody else's.
 *
 * Two pages, five fields, deliberately spread across both pages — a fixture
 * with every field on page 1 would pass a split that drops page 2's fields.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const form = doc.getForm();

const label = (page, text, y) => page.drawText(text, { x: 60, y, size: 11, font, color: rgb(0, 0, 0) });

const p1 = doc.addPage([595, 842]);
p1.drawText("Application form — page 1", { x: 60, y: 780, size: 16, font });

label(p1, "Full name", 720);
form.createTextField("applicant.name").addToPage(p1, { x: 60, y: 690, width: 300, height: 24 });

label(p1, "Email", 640);
form.createTextField("applicant.email").addToPage(p1, { x: 60, y: 610, width: 300, height: 24 });

label(p1, "Subscribe to updates", 560);
form.createCheckBox("applicant.subscribe").addToPage(p1, { x: 60, y: 530, width: 18, height: 18 });

const p2 = doc.addPage([595, 842]);
p2.drawText("Application form — page 2", { x: 60, y: 780, size: 16, font });

label(p2, "Preferred contact", 720);
const radio = form.createRadioGroup("applicant.contact");
radio.addOptionToPage("email", p2, { x: 60, y: 690, width: 18, height: 18 });
radio.addOptionToPage("phone", p2, { x: 60, y: 660, width: 18, height: 18 });

label(p2, "Notes", 610);
const notes = form.createTextField("applicant.notes");
notes.enableMultiline();
notes.addToPage(p2, { x: 60, y: 500, width: 400, height: 100 });

const bytes = await doc.save();
fs.writeFileSync(path.join(HERE, "form.pdf"), bytes);
console.log("wrote form.pdf", bytes.length, "bytes,", doc.getPageCount(), "pages,",
            form.getFields().length, "fields:", form.getFields().map(f => f.getName()).join(", "));
