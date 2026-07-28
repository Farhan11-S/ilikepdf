/* The file card grid: thumbnails, drag-to-reorder with FLIP, remove, add-more.

   render() rebuilds the whole grid every time. That is fine at this scale —
   FLIP hides the rebuild by animating each card from where it used to be. */

import * as store from "./store.js";

export function mountGrid(gridEl, { onAdd }){
  let dragId = null;

  function render(){
    // FIRST: where every card is right now.
    const before = new Map();
    [...gridEl.querySelectorAll(".card")].forEach(c => before.set(c.dataset.id, c.getBoundingClientRect()));

    gridEl.innerHTML = "";
    const files = store.list();

    files.forEach((f, i) => {
      const card = document.createElement("div");
      card.className = "card";
      card.draggable = true;
      card.dataset.id = f.id;
      // Stagger only on the very first paint; later renders are reorders.
      card.style.animationDelay = before.size ? "0ms" : (i * 45) + "ms";

      const thumb = document.createElement("div");
      thumb.className = "thumb-box";
      if(f.thumb) thumb.appendChild(f.thumb);
      else thumb.innerHTML = '<span class="placeholder">📕</span>';

      card.innerHTML =
        '<span class="order">' + (i + 1) + '</span>' +
        '<button class="remove" title="Remove file">✕</button>';
      card.appendChild(thumb);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = f.name;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = pageLabel(f) + " · " + fileSize(f.size);

      const move = document.createElement("div");
      move.className = "move";
      move.innerHTML =
        '<button data-dir="-1" aria-label="Move left">←</button>' +
        '<button data-dir="1" aria-label="Move right">→</button>';

      card.append(name, meta, move);

      card.querySelector(".remove").onclick = e => { e.stopPropagation(); store.remove(f.id); };
      move.querySelectorAll("button").forEach(b => b.onclick = e => {
        e.stopPropagation();
        store.shift(f.id, +b.dataset.dir);
      });

      card.addEventListener("dragstart", ev => {
        dragId = f.id;
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", String(f.id));
        requestAnimationFrame(() => card.classList.add("dragging"));
      });
      card.addEventListener("dragend", () => { dragId = null; render(); });
      card.addEventListener("dragover", ev => {
        if(dragId === null) return;
        ev.preventDefault();
        const from = store.indexOf(dragId);
        const to = store.indexOf(f.id);
        if(from === -1 || to === -1 || from === to) return;
        // Drop after this card if the pointer is past its midpoint.
        const rect = card.getBoundingClientRect();
        const after = ev.clientX > rect.left + rect.width / 2;
        let target = to + (after ? 1 : 0);
        if(target > from) target--;
        if(target === from) return;
        store.moveTo(from, target);
        // The re-render dropped the class off the card being dragged.
        gridEl.querySelector('.card[data-id="' + dragId + '"]')?.classList.add("dragging");
      });

      gridEl.appendChild(card);
    });

    const add = document.createElement("button");
    add.className = "add-card";
    add.innerHTML = '<span><span class="plus">+</span><br>Add more files</span>';
    add.onclick = onAdd;
    gridEl.appendChild(add);

    // LAST / INVERT / PLAY.
    if(before.size){
      gridEl.querySelectorAll(".card").forEach(c => {
        const old = before.get(c.dataset.id);
        if(!old) return;
        const now = c.getBoundingClientRect();
        const dx = old.left - now.left, dy = old.top - now.top;
        if(!dx && !dy) return;
        c.style.animation = "none";
        c.style.transform = `translate(${dx}px,${dy}px)`;
        c.style.transition = "none";
        requestAnimationFrame(() => {
          c.style.transition = "transform .28s cubic-bezier(.2,.9,.3,1)";
          c.style.transform = "";
        });
      });
    }
  }

  store.subscribe(render);
  return { render };
}

function pageLabel(f){
  if(f.pages === null) return "reading…";
  return f.pages + (f.pages === 1 ? " page" : " pages");
}

export function fileSize(bytes){
  return bytes < 1048576
    ? Math.max(1, Math.round(bytes / 1024)) + " KB"
    : (bytes / 1048576).toFixed(1) + " MB";
}
