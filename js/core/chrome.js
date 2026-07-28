/* Shared header and footer. Side-effect module: importing it fills in the
   <header class="site-header"> and <footer class="site-footer"> shells.

   The shells live in the HTML rather than being created here, so the header
   keeps its 64px height and its sticky positioning before any script runs —
   injecting the whole element would make the page jump on load.

   The active nav item is derived from the URL, so pages don't declare it. */

import { TOOLS } from "./tools.js";

const here = location.pathname.split("/").pop() || "index.html";

function headerHTML(){
  const links = TOOLS.filter(t => t.nav).map(t => {
    if(!t.ready) return `<a class="soon" aria-disabled="true">${t.name}</a>`;
    const active = t.href === here ? ' class="active" aria-current="page"' : "";
    return `<a href="${t.href}"${active}>${t.name}</a>`;
  });
  links.push(`<a href="index.html"${here === "index.html" ? ' class="active" aria-current="page"' : ""}>All tools</a>`);

  return `<a class="logo" href="index.html"><span class="thumb">👍</span>I<span class="accent">like</span>PDF</a>
    <nav class="nav" aria-label="Tools">${links.join("")}</nav>`;
}

function footerHTML(){
  const links = TOOLS.map(t => t.ready
    ? `<a href="${t.href}">${t.name}</a>`
    : `<span class="soon">${t.name}</span>`
  ).join("");

  return `<nav class="footer-tools" aria-label="All tools">${links}</nav>
    <p class="privacy">🔒 Your files stay on your device. Nothing is uploaded, nothing is stored.</p>`;
}

const header = document.querySelector(".site-header");
if(header) header.innerHTML = headerHTML();

const footer = document.querySelector(".site-footer");
if(footer) footer.innerHTML = footerHTML();
