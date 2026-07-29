/* The one grid every tool uses.

   It takes a list of items — `{id, label, meta, thumb}` — and knows nothing
   about what they are. Files, pages of one document, pages gathered from
   several: all the same to it.

   What it provides, all optional:
     render     lazy thumbnails via IntersectionObserver, one at a time
     reorder    drag, arrow keys or ← → buttons, animated with FLIP
     onRemove   a ✕ in the corner
     onToggle   the whole tile becomes a button
     controls   per-tile buttons (rotate left/right, move ←/→)
     describe   per-item decoration: selected, caption, tag, rotation, stamp
     onAdd      a trailing "add more" button

   Two variants, differing only in shape: "card" (file-sized, name + meta
   underneath) and "tile" (page-sized, a single caption).

   refresh() rebuilds the whole grid. That's fine at this scale — FLIP hides
   the rebuild by animating each tile from where it used to be, and rendered
   thumbnails are cached by item id so reordering never re-renders. */

const FLIP_EASE = "transform .28s cubic-bezier(.2,.9,.3,1)";

export function mountGrid(el, opts){
  const {
    variant = "card",
    items,
    render = null,
    describe = null,
    reorder = null,
    onReorderStart = null,   // fires once per drag, before any reorder call
    onRemove = null,
    onToggle = null,
    controls = null,
    controlsStyle = "overlay",
    onAdd = null,
    addLabel = "Add more files",
    showOrder = false,
    placeholder = variant === "tile" ? "📄" : "📕"
  } = opts;

  // A tile is either a button you click or a plain element holding buttons.
  // Nesting one inside the other isn't valid HTML, so pick one.
  if(onToggle && (controls || onRemove)){
    throw new Error("grid: onToggle can't be combined with controls or onRemove");
  }

  const tileClass = variant === "tile" ? "page-tile" : "card";
  const sel = "." + tileClass;
  const thumbCache = new Map();   // item id -> canvas, so reordering never re-renders

  let token = 0;                  // bumped by reset() to cancel in-flight renders
  let dragId = null;
  const queue = [];
  let pumping = false;

  const io = render
    ? new IntersectionObserver(entries => {
        for(const e of entries){
          if(!e.isIntersecting) continue;
          io.unobserve(e.target);
          queue.push(e.target.dataset.id);
        }
        pump();
      }, { rootMargin: "400px 0px" })
    : null;

  // Scanned rather than selected, so an id never has to be escaped for CSS.
  const find = id => [...el.querySelectorAll(sel)].find(t => t.dataset.id === String(id));

  async function pump(){
    if(pumping) return;
    pumping = true;
    const mine = token;
    while(queue.length && mine === token){
      const id = queue.shift();
      if(thumbCache.has(id)) continue;
      const list = items();
      const i = list.findIndex(x => String(x.id) === String(id));
      if(i === -1) continue;                       // deleted while queued
      try{
        const canvas = await render(list[i], i);
        if(mine !== token) break;
        thumbCache.set(String(id), canvas);
        // The tile may have moved or gone while we were rendering.
        const tile = find(id);
        if(tile){
          tile.querySelector(".thumb-box").replaceChildren(canvas);
          tile.dataset.rendered = "1";
          decorate(tile, list[i], i);              // a late arrival still gets its state
        }
      }catch(e){
        // Leave the placeholder; one unrenderable page isn't fatal.
      }
    }
    pumping = false;
  }

  /* ---------- tile construction ---------- */

  function buildTile(item, i, rebuilding){
    const clickable = Boolean(onToggle);
    const tile = document.createElement(clickable ? "button" : "div");
    if(clickable){
      tile.type = "button";
      tile.addEventListener("click", () => onToggle(item, i));
    }
    tile.className = "tile " + tileClass;
    tile.dataset.id = item.id;
    tile.dataset.index = i;
    // Stagger only the first paint, and only the first screenful — a 500-page
    // document shouldn't ripple forever.
    tile.style.animationDelay = rebuilding ? "0ms" : Math.min(i, 14) * 40 + "ms";

    if(showOrder){
      const order = document.createElement("span");
      order.className = "order";
      order.textContent = i + 1;
      tile.appendChild(order);
    }

    if(onRemove){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "remove";
      btn.textContent = "✕";
      btn.title = "Remove";
      btn.setAttribute("aria-label", `Remove ${item.label ?? "item"}`);
      btn.addEventListener("click", ev => { ev.stopPropagation(); onRemove(item, i); });
      tile.appendChild(btn);
    }

    const box = document.createElement("div");
    box.className = "thumb-box";
    const canvas = thumbCache.get(String(item.id)) || item.thumb;
    if(canvas){
      box.appendChild(canvas);
      tile.dataset.rendered = "1";
    }else{
      box.innerHTML = `<span class="placeholder">${placeholder}</span>`;
    }
    tile.appendChild(box);

    if(variant === "tile"){
      const cap = document.createElement("div");
      cap.className = "page-no";
      tile.appendChild(cap);
    }else{
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = item.label ?? "";
      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = item.meta ?? "";
      tile.append(name, meta);
    }

    if(controls) tile.appendChild(buildControls(item, i));

    const mark = document.createElement("span");
    mark.className = "mark";
    mark.hidden = true;
    mark.setAttribute("aria-hidden", "true");
    tile.appendChild(mark);

    if(reorder) makeMovable(tile, item, i);
    decorate(tile, item, i);
    return tile;
  }

  function buildControls(item, i){
    // "row" sits under the caption and is touch-only (merge's ← →);
    // "overlay" floats over the thumbnail on hover (rotate's ↺ ↻).
    const row = controlsStyle === "row";
    const bar = document.createElement("div");
    bar.className = row ? "move" : "tile-controls";
    for(const c of controls){
      const b = document.createElement("button");
      b.type = "button";
      if(!row) b.className = "tile-btn";
      b.dataset.action = c.id;
      b.textContent = c.label;
      b.setAttribute("aria-label", `${c.title}${variant === "tile" ? `, page ${i + 1}` : ""}`);
      b.title = c.title;
      b.addEventListener("click", ev => { ev.stopPropagation(); c.onClick(item, i); });
      bar.appendChild(b);
    }
    return bar;
  }

  /* describe(item, i) -> {selected, clickable, caption, tag, rotate, stamp} */
  function decorate(tile, item, i){
    const s = describe ? (describe(item, i) || {}) : {};

    tile.classList.toggle("selected", !!s.selected);

    if(onToggle){
      tile.disabled = s.clickable === false;
      if(!tile.disabled) tile.setAttribute("aria-pressed", s.selected ? "true" : "false");
      else tile.removeAttribute("aria-pressed");
      tile.setAttribute("aria-label", s.label || item.label || `Item ${i + 1}`);
    }

    const cap = tile.querySelector(".page-no");
    if(cap) cap.textContent = s.caption ?? item.label ?? String(i + 1);

    const mark = tile.querySelector(".mark");
    mark.textContent = s.tag ?? "";
    mark.hidden = s.tag === undefined || s.tag === null || s.tag === "";

    const box = tile.querySelector(".thumb-box");
    const canvas = tile.querySelector("canvas");
    if(canvas) applyRotation(canvas, box, s.rotate || 0);
    applyStamp(box, canvas, s.stamp);
  }

  /* ---------- reordering: by drag, by touch buttons, by keyboard ---------- */

  function makeMovable(tile, item, i){
    tile.draggable = true;

    /* A reorderable tile is a div — it can't be a button, because it already
       holds buttons — so it needs a tab stop of its own or the whole
       interaction is mouse-and-touch only. The ← → buttons underneath are
       touch-only (hover:none), so they are not the keyboard path either. */
    tile.tabIndex = 0;
    tile.setAttribute("aria-label",
      `${item.label ?? "Item"}, position ${i + 1} of ${items().length}. ` +
      "Use the arrow keys to move it.");

    tile.addEventListener("keydown", ev => {
      const dir = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1
                : ev.key === "ArrowLeft"  || ev.key === "ArrowUp"   ? -1
                : 0;
      if(!dir || ev.altKey || ev.ctrlKey || ev.metaKey) return;

      const list = items();
      const from = list.findIndex(x => String(x.id) === String(item.id));
      const to = from + dir;
      if(from === -1 || to < 0 || to >= list.length) return;

      ev.preventDefault();
      onReorderStart?.();      // one undo step per press, same as one drag
      reorder(from, to);
      // The caller refreshed the grid, so this element is gone; follow the
      // item to its new tile or focus lands back on the document.
      find(item.id)?.focus();
    });

    tile.addEventListener("dragstart", ev => {
      dragId = item.id;
      // One notification per drag, not per dragover — undo should step back a
      // whole move, not each intermediate position the pointer passed through.
      onReorderStart?.();
      ev.dataTransfer.effectAllowed = "move";
      ev.dataTransfer.setData("text/plain", String(item.id));
      requestAnimationFrame(() => tile.classList.add("dragging"));
    });

    tile.addEventListener("dragend", () => { dragId = null; refresh(); });

    tile.addEventListener("dragover", ev => {
      if(dragId === null) return;
      ev.preventDefault();
      const list = items();
      const from = list.findIndex(x => String(x.id) === String(dragId));
      const to = list.findIndex(x => String(x.id) === String(item.id));
      if(from === -1 || to === -1 || from === to) return;
      // Drop after this tile if the pointer is past its midpoint.
      const rect = tile.getBoundingClientRect();
      const after = ev.clientX > rect.left + rect.width / 2;
      let target = to + (after ? 1 : 0);
      if(target > from) target--;
      if(target === from) return;
      // The caller is responsible for leaving the grid refreshed.
      reorder(from, target);
      find(dragId)?.classList.add("dragging");
    });
  }

  /* ---------- rendering the whole grid ---------- */

  function refresh(){
    // FIRST: where every tile is right now.
    const before = new Map();
    [...el.querySelectorAll(sel)].forEach(t => before.set(t.dataset.id, t.getBoundingClientRect()));

    io?.disconnect();
    el.replaceChildren();

    const list = items();
    list.forEach((item, i) => el.appendChild(buildTile(item, i, before.size > 0)));

    if(onAdd){
      const add = document.createElement("button");
      add.type = "button";
      add.className = "add-card";
      add.innerHTML = `<span><span class="plus">+</span><br>${addLabel}</span>`;
      add.addEventListener("click", onAdd);
      el.appendChild(add);
    }

    if(io){
      el.querySelectorAll(sel).forEach(t => { if(!t.dataset.rendered) io.observe(t); });
    }

    // LAST / INVERT / PLAY.
    if(before.size){
      el.querySelectorAll(sel).forEach(t => {
        const old = before.get(t.dataset.id);
        if(!old) return;
        const now = t.getBoundingClientRect();
        const dx = old.left - now.left, dy = old.top - now.top;
        if(!dx && !dy) return;
        t.style.animation = "none";
        t.style.transform = `translate(${dx}px,${dy}px)`;
        t.style.transition = "none";
        requestAnimationFrame(() => {
          t.style.transition = FLIP_EASE;
          t.style.transform = "";
        });
      });
    }
  }

  /* Re-apply describe() to the tiles already on screen. Cheaper than refresh()
     and it keeps scroll position and hover, so it's what to call when only the
     decoration changed — a mode switch, a new range, another page turned. */
  function paint(){
    const list = items();
    [...el.querySelectorAll(sel)].forEach(t => {
      const i = Number(t.dataset.index);
      if(list[i]) decorate(t, list[i], i);
    });
  }

  /* Throw away every rendered thumbnail — a different document is coming. */
  function reset(){
    token++;
    queue.length = 0;
    thumbCache.clear();
    io?.disconnect();
    el.replaceChildren();
  }

  return { refresh, paint, reset };
}

/* Shows where a stamp — a page number, a watermark — will land, by drawing a
   label over the thumbnail in the same place. `stamp` is
   {text, anchor, angle, tiled}:

     anchor  tl tc tr bl bc br c
     angle   degrees counter-clockwise, matching pdf-lib
     tiled   {cols, rows} to repeat evenly across the page instead

   The caller owns the tile counts because it is the only one that knows how big
   the mark is in points — the grid would otherwise be guessing, and a preview
   with a different number of marks than the export is worse than no preview.

   This runs from decorate() rather than tile construction because a thumbnail
   arriving late replaces everything inside .thumb-box (see pump()), so anything
   built up front would be thrown away the moment the page finished rendering.

   Positions follow the canvas, not the box: the canvas is letterboxed inside
   its box by place-items:center, and a corner stamp pinned to the box corner
   would sit off the page it is supposed to be on. */
const ANCHORS = {
  tl: [0, 0],   tc: [.5, 0],   tr: [1, 0],
  c:  [.5, .5],
  bl: [0, 1],   bc: [.5, 1],   br: [1, 1]
};

/* Fractions of the page each mark sits at, as [fx, fy] pairs. */
export function stampSpots(stamp){
  const t = stamp.tiled;
  if(!t) return [ANCHORS[stamp.anchor] || ANCHORS.bc];
  const spots = [];
  for(let r = 0; r < t.rows; r++){
    for(let c = 0; c < t.cols; c++){
      spots.push([(c + 0.5) / t.cols, (r + 0.5) / t.rows]);
    }
  }
  return spots;
}

function applyStamp(box, canvas, stamp){
  if(!box) return;
  const spots = stamp && stamp.text ? stampSpots(stamp) : [];
  const marks = [...box.querySelectorAll(".stamp")];

  for(let n = marks.length; n > spots.length; n--) marks.pop().remove();
  for(let n = marks.length; n < spots.length; n++){
    const el = document.createElement("span");
    el.className = "stamp";
    el.setAttribute("aria-hidden", "true");   // the panel already says this in words
    box.appendChild(el);
    marks.push(el);
  }
  if(!spots.length) return;

  // Inset of the page within its box. offsetLeft is relative to .thumb-box,
  // which is position:relative for exactly this reason.
  const x0 = canvas ? canvas.offsetLeft : 0;
  const y0 = canvas ? canvas.offsetTop : 0;
  const w = canvas ? canvas.offsetWidth : box.clientWidth;
  const h = canvas ? canvas.offsetHeight : box.clientHeight;
  // Tiled marks sit on their centres; an anchored one pulls back inside the
  // page so a corner anchor stays on the page rather than half off it.
  const tiled = Boolean(stamp.tiled);

  spots.forEach(([fx, fy], k) => {
    const el = marks[k];
    el.textContent = stamp.text;
    el.style.left = (x0 + fx * w) + "px";
    el.style.top = (y0 + fy * h) + "px";
    const [px, py] = tiled ? [50, 50] : [fx * 100, fy * 100];
    // CSS rotates clockwise, pdf-lib counter-clockwise.
    el.style.transform = `translate(${-px}%, ${-py}%) rotate(${-(stamp.angle || 0)}deg)`;
    el.classList.toggle("tiled", tiled);
  });
}

/* Turning a portrait thumbnail on its side makes it wider than its box, so a
   quarter turn also scales down to fit. The CSS transition on the canvas is
   what makes this read as the page turning rather than snapping. */
function applyRotation(canvas, box, deg){
  const d = ((deg % 360) + 360) % 360;
  if(d % 180 === 0){
    canvas.style.transform = d ? `rotate(${d}deg)` : "";
    return;
  }
  const w = canvas.offsetWidth, h = canvas.offsetHeight;
  if(!w || !h) return;
  const fit = Math.min(box.clientWidth / h, box.clientHeight / w, 1);
  canvas.style.transform = `rotate(${d}deg) scale(${fit.toFixed(4)})`;
}
