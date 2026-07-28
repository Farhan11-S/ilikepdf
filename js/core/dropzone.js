/* Page-wide drag and drop, with the full-screen red overlay.

   dragenter/dragleave fire for every child element the pointer crosses, so we
   count depth rather than toggling — otherwise the overlay flickers. */

export function mountDropzone({ overlay, hot, onFiles }){
  let depth = 0;

  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");

  function show(){
    overlay?.classList.add("show");
    hot?.classList.add("hot");
  }
  function clear(){
    overlay?.classList.remove("show");
    hot?.classList.remove("hot");
  }

  window.addEventListener("dragenter", e => {
    if(!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    show();
  });
  window.addEventListener("dragover", e => {
    if(!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragleave", e => {
    if(!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if(!depth) clear();
  });
  window.addEventListener("drop", e => {
    if(!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    clear();
    onFiles(e.dataTransfer.files);
  });
}
