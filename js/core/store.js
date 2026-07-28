/* The file list. Single source of truth for every tool.
   Array order IS output order — never sort for display.
   Entries: {id, name, size, bytes, pages, thumb} */

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

/* Reads every PDF in the list into memory and appends it.
   Returns what happened so the caller can decide which error to show. */
export async function addFiles(fileList){
  const incoming = [...fileList];
  const pdfs = incoming.filter(isPdf);
  if(!pdfs.length) return { added: [], rejected: incoming.length };

  const added = [];
  for(const file of pdfs){
    const bytes = new Uint8Array(await file.arrayBuffer());
    const entry = { id: ++uid, name: file.name, size: file.size, bytes, pages: null, thumb: null };
    files.push(entry);
    added.push(entry);
  }
  notifyChange();
  return { added, rejected: incoming.length - pdfs.length };
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
