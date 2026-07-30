/* The file list. Single source of truth for every tool.
   Array order IS output order — never sort for display.
   Entries: {id, name, size, bytes, pages, thumb, form, signed, unreadable} */

import { fileSize } from "./format.js";

const files = [];
const subs = new Set();
let uid = 0;

export function subscribe(fn){
  subs.add(fn);
  return () => subs.delete(fn);
}

/* Public because tools mutate entries in place (thumbnails arriving late)
   and then need the UI to catch up. */
export function notifyChange(){
  subs.forEach(fn => fn(files));
}

export function list(){ return files; }
export function count(){ return files.length; }
export function indexOf(id){ return files.findIndex(f => f.id === id); }

export function isPdf(file){
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/* PNG and JPEG only — the two formats pdf-lib can embed. */
export function isImage(file){
  return /^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

/* Everything happens in a tab, so a file big enough to exhaust it is a real
   risk. Warn, don't block: whether 200 MB is too much depends on the machine,
   and refusing to try is worse than trying and being slow. */
export const BIG_FILE = 100 * 1024 * 1024;

/* What's wrong with a file before anything tries to parse it.
   `error` means don't bother; `warning` means it will work but may struggle. */
export function inspect(file){
  if(file.size === 0){
    return { error: `"${file.name}" is empty — there are no bytes in it to read.` };
  }
  if(file.size > BIG_FILE){
    return { warning: `"${file.name}" is ${fileSize(file.size)}. Everything happens in this tab, so it may be slow.` };
  }
  return {};
}

/* Reads every PDF in the list into memory and appends it.
   Returns what happened so the caller can decide which error to show. */
export async function addFiles(fileList){
  const incoming = [...fileList];
  const pdfs = incoming.filter(isPdf);
  if(!pdfs.length) return { added: [], rejected: incoming.length, notes: [] };

  const added = [];
  const notes = [];
  for(const file of pdfs){
    const { error, warning } = inspect(file);
    if(error){ notes.push(error); continue; }
    if(warning) notes.push(warning);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entry = { id: ++uid, name: file.name, size: file.size, bytes, pages: null, thumb: null, form: false, signed: false, unreadable: false };
    files.push(entry);
    added.push(entry);
  }
  notifyChange();
  return { added, rejected: incoming.length - pdfs.length, notes };
}

export function remove(id){
  const i = indexOf(id);
  if(i === -1) return;
  files.splice(i, 1);
  notifyChange();
}

/* Swap with the neighbour `dir` steps away. Used by the touch reorder buttons. */
export function shift(id, dir){
  const i = indexOf(id);
  const j = i + dir;
  if(i === -1 || j < 0 || j >= files.length) return;
  [files[i], files[j]] = [files[j], files[i]];
  notifyChange();
}

export function moveTo(from, to){
  if(from === to || from < 0 || from >= files.length) return;
  const [moved] = files.splice(from, 1);
  files.splice(to, 0, moved);
  notifyChange();
}

export function clear(){
  files.length = 0;
  notifyChange();
}

/* Entries not yet hydrated with a page count and thumbnail. */
export function pending(){
  return files.filter(f => f.pages === null);
}
