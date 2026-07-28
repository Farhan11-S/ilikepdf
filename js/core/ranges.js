/* Page-range syntax: "1-4, 7, 9-12".

   Pure and DOM-free so tests can import it directly. Returns an error string
   rather than throwing — the panel shows it as you type, and half-typed input
   is normal, not exceptional. Pages are 1-based here, as the user writes them. */

import { plural } from "./format.js";

export function parseRanges(text, maxPage){
  const parts = String(text ?? "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
  if(!parts.length) return { ranges: [], error: null };

  const ranges = [];
  for(const part of parts){
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if(!m) return { ranges: [], error: `"${part}" isn't a page or a range like 3-8.` };

    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);

    if(from < 1) return { ranges: [], error: "Pages start at 1." };
    if(to < from) return { ranges: [], error: `"${part}" runs backwards — write it as ${to}-${from}.` };
    if(to > maxPage) return { ranges: [], error: `This PDF only has ${plural(maxPage, "page")}.` };

    ranges.push({ from, to });
  }
  return { ranges, error: null };
}

/* 1-based inclusive range -> 0-based page indices for pdf-lib. */
export function toIndices({ from, to }){
  return Array.from({ length: to - from + 1 }, (_, k) => from - 1 + k);
}
