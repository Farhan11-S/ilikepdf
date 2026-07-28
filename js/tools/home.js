/* Landing page: the tool directory.
   Tools that aren't built yet stay on the grid, visibly disabled — they tell
   you what's coming, and hiding them would just make the page look empty. */

import "../core/chrome.js";
import { TOOLS } from "../core/tools.js";

const grid = document.getElementById("toolGrid");

grid.innerHTML = TOOLS.map((t, i) => {
  // A disabled tool is a <div>, not an <a> — nothing to focus, nothing to follow.
  const tag = t.ready ? "a" : "div";
  const attrs = t.ready ? ` href="${t.href}"` : ' aria-disabled="true"';
  return `<${tag} class="tool-card${t.ready ? "" : " soon"}"${attrs} style="animation-delay:${i * 40}ms">
      <span class="icon">${t.icon}</span>
      <h3>${t.name}${t.ready ? "" : '<span class="badge">Soon</span>'}</h3>
      <p>${t.blurb}</p>
    </${tag}>`;
}).join("");

const ready = TOOLS.filter(t => t.ready).length;
document.getElementById("toolCount").textContent =
  ready === TOOLS.length
    ? `${TOOLS.length} tools, all free.`
    : `${ready} of ${TOOLS.length} tools ready so far — the rest are on the way.`;
