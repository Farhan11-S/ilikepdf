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
   is reported as form-free rather than blocking an export that would work. */
export async function hasForm(doc){
  try{
    const fields = await doc.getFieldObjects();
    return !!fields && Object.keys(fields).length > 0;
  }catch{
    return false;
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
