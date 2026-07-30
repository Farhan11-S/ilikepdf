/* Spotting AcroForm fields, so a tool can say what it is about to lose.

   pdf-lib's copyPages carries a page's widget annotations across but *not* the
   catalog's /AcroForm dictionary. What survives is more than it sounds and less
   than it looks — measured on both a generated fixture and hexapdf's public
   example (see NEXT.md 10.1):

     survives : every widget, with /FT, /Parent, /AP and /V intact. The page
                renders pixel-for-pixel identically, values and all, and a
                viewer that builds its form UI from page annotations — pdf.js,
                and so Firefox; PDFium, and so Chrome — still shows fillable
                boxes. This is why the loss looks like nothing happened.
     lost     : the document-level form. /Fields, /DR, /DA, the field
                hierarchy, calculation order. pdf-lib's getForm().getFields()
                returns 0 and pdf.js's getFieldObjects() returns null, so
                anything that reads or fills form data no longer sees a form.

   **Do not describe this as "the fields will be gone".** They visibly are not,
   which makes that wording read as a false alarm to anyone who checks — it was
   the first thing a real file disproved.

   Merge, Split and Organize all copy pages, so all three have to say so up
   front. Rotate, Page numbers and Watermark load and mutate the document in
   place, never copying, and keep the form intact — don't add this to them.

   Copying the form across properly is a real piece of work (field hierarchy,
   /DA and /DR resources, appearance streams, radio-group kids) and is squarely
   in the class of things this project declines to half-do. Saying so is the
   fix. See NEXT.md phase 10. */

/* Rides on the pdf.js document each tool already has open for thumbnails, so
   detection costs no extra parse. Never throws: a document we cannot ask about
   is reported as having nothing, rather than blocking an export that works.

   Signatures are separated out because a signature *is* an AcroForm field —
   a signed PDF answers yes to "has fields", and telling its owner about form
   data would be answering a question they didn't ask. pdf.js types them for
   us. See 10.7 for what actually happens to each. */
export async function inspectFields(doc){
  try{
    const fields = await doc.getFieldObjects();
    if(!fields) return { form: false, signed: false };
    let form = false, signed = false;
    for(const group of Object.values(fields)){
      for(const f of group) f.type === "signature" ? signed = true : form = true;
    }
    return { form, signed };
  }catch{
    return { form: false, signed: false };
  }
}

/* One wording, three tools. `verb` is what is about to happen to the pages.
   Deliberately claims only what was measured: the boxes and their contents come
   through, the form does not. Overclaiming here is worse than saying nothing —
   a warning a user can disprove in one try is a warning they stop reading. */
export function formWarning(names, verb){
  const who = names.length === 1
    ? `"${names[0]}" has`
    : `${names.length} of these files have`;
  return `${who} form fields. Being ${verb} keeps the boxes and what's in ` +
         `them, but not the form itself — software that reads or fills form ` +
         `data will no longer see one.`;
}

/* Signatures break two different ways (10.7): the page-copying tools drop the
   signature entirely, the in-place ones leave one that no longer verifies. One
   wording covers both without picking a side, because the only thing a user
   needs to decide is whether to go ahead. Which mechanism applies to which tool
   belongs in NEXT.md, not in a panel message.

   Not shown by PDF→JPG or JPG→PDF: images cannot carry a signature, so there
   the loss is the point of the conversion rather than a surprise. */
export function signedWarning(names, verb){
  const who = names.length === 1
    ? `"${names[0]}" is`
    : `${names.length} of these files are`;
  return `${who} digitally signed. The signature won't survive being ${verb}.`;
}
