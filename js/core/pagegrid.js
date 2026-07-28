/* Page-level thumbnail grid — one tile per page of a single document.

   A 500-page PDF is 500 canvases, so thumbnails are rendered lazily: an
   IntersectionObserver queues a page only once its tile nears the viewport, and
   the queue renders one page at a time so scrolling fast can't spawn hundreds
   of concurrent pdf.js jobs.

   The tool owns the meaning of a tile. It supplies describe(i), which returns
   how page i should currently look; the grid just applies it. */

import { renderPage } from "./thumbs.js";

const THUMB_W = 122;
const THUMB_H = 158;

export function mountPageGrid(el, { onToggle, controls } = {}){
  // A tile is either a button you click, or a plain element holding buttons.
  // Nesting one inside the other isn't valid HTML, so pick one.
  if(onToggle && controls){
    throw new Error("pagegrid: use onToggle or controls, not both");
  }

  let doc = null;
  let token = 0;                  // bumped on load() to cancel in-flight renders
  let describe = () => ({});
  const queue = [];
  let pumping = false;

  const io = new IntersectionObserver(entries => {
    for(const e of entries){
      if(!e.isIntersecting) continue;
      io.unobserve(e.target);              // render once, never again
      queue.push(Number(e.target.dataset.index));
    }
    pump();
  }, { rootMargin: "400px 0px" });         // start a little before they scroll in

  async function pump(){
    if(pumping || !doc) return;
    pumping = true;
    const mine = token;
    while(queue.length && mine === token){
      const i = queue.shift();
      const tile = el.querySelector(`.page-tile[data-index="${i}"]`);
      if(!tile || tile.dataset.rendered) continue;
      try{
        const page = await doc.getPage(i + 1);
        const canvas = await renderPage(page, THUMB_W, THUMB_H);
        if(mine !== token) break;          // document changed under us
        const box = tile.querySelector(".thumb-box");
        box.replaceChildren(canvas);
        tile.dataset.rendered = "1";
        decorate(tile, i);          // a late arrival still picks up its rotation
      }catch(e){
        // Leave the placeholder in place; one unrenderable page isn't fatal.
      }
    }
    pumping = false;
  }

  function load(newDoc){
    token++;
    queue.length = 0;
    io.disconnect();
    doc = newDoc;
    el.replaceChildren();
    if(!doc) return;

    for(let i = 0; i < doc.numPages; i++){
      const tile = document.createElement(onToggle ? "button" : "div");
      if(onToggle){
        tile.type = "button";
        tile.addEventListener("click", () => onToggle(i));
      }
      tile.className = "page-tile";
      tile.dataset.index = i;
      // Only stagger the first screenful; a 500-page doc shouldn't ripple forever.
      tile.style.animationDelay = Math.min(i, 14) * 30 + "ms";
      tile.innerHTML =
        '<div class="thumb-box"><span class="placeholder">📄</span></div>' +
        '<div class="page-no"></div>' +
        '<span class="mark" aria-hidden="true"></span>';

      if(controls){
        const bar = document.createElement("div");
        bar.className = "tile-controls";
        for(const c of controls){
          const b = document.createElement("button");
          b.type = "button";
          b.className = "tile-btn";
          b.dataset.action = c.id;
          b.textContent = c.label;
          b.setAttribute("aria-label", `${c.title}, page ${i + 1}`);
          b.title = c.title;
          b.addEventListener("click", ev => { ev.stopPropagation(); c.onClick(i); });
          bar.appendChild(b);
        }
        tile.appendChild(bar);
      }

      el.appendChild(tile);
      io.observe(tile);
    }
    paint();
  }

  /* describe(i) -> { selected, tag, clickable, caption, label, rotate } */
  function decorate(tile, i){
    const s = describe(i) || {};

    tile.classList.toggle("selected", !!s.selected);
    if(onToggle){
      tile.disabled = !s.clickable;
      if(s.clickable) tile.setAttribute("aria-pressed", s.selected ? "true" : "false");
      else tile.removeAttribute("aria-pressed");
      tile.setAttribute("aria-label", s.label || `Page ${i + 1}`);
    }

    tile.querySelector(".page-no").textContent = s.caption ?? String(i + 1);

    const mark = tile.querySelector(".mark");
    mark.textContent = s.tag ?? "";
    mark.hidden = s.tag === undefined || s.tag === null || s.tag === "";

    const canvas = tile.querySelector("canvas");
    if(canvas) applyRotation(canvas, tile.querySelector(".thumb-box"), s.rotate || 0);
  }

  function paint(){
    [...el.children].forEach((tile, i) => decorate(tile, i));
  }

  return {
    load,
    paint,
    setDescribe(fn){ describe = fn; paint(); }
  };
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
