/* The bottom-right busy pill.

   Libraries now load on demand, which means there are moments — the first
   Export, the first thumbnail — where the page is doing something with nothing
   on screen to show for it. The pill is that something.

   Ref-counted rather than a boolean: two loads can overlap (a tool that needs
   pdf-lib and JSZip in the same click), and the first one finishing must not
   hide the pill out from under the second. */

let depth = 0;
let el = null;

function ensure(){
  if(el) return el;
  el = document.createElement("div");
  el.className = "loading-pill";
  // Announced, but politely — this is progress, not a problem.
  el.setAttribute("role", "status");
  el.innerHTML = '<span class="spin" aria-hidden="true"></span><span class="pill-text"></span>';
  document.body.appendChild(el);
  return el;
}

export function busy(text = "Working…"){
  const pill = ensure();
  pill.querySelector(".pill-text").textContent = text;
  depth++;
  pill.classList.add("on");
}

export function idle(){
  depth = Math.max(0, depth - 1);
  if(!depth) el?.classList.remove("on");
}

export async function withBusy(text, fn){
  busy(text);
  try{
    return await fn();
  }finally{
    idle();
  }
}
