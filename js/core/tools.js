/* The tool registry — one source of truth for the landing grid, the header nav,
   and the footer. Adding a tool means adding a row here and flipping `ready`.

   icon: inline SVG markup, 24x24, stroke-based, inherits currentColor.
   nav:  show this tool in the header nav (there is no room for all of them). */

const stroke = d =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const TOOLS = [
  {
    id: "merge",
    name: "Merge PDF",
    href: "merge.html",
    blurb: "Combine several PDFs into one, in the order you choose.",
    ready: true,
    nav: true,
    icon: stroke('<rect x="3" y="3" width="11" height="13" rx="2"/><rect x="10" y="8" width="11" height="13" rx="2"/>')
  },
  {
    id: "split",
    name: "Split PDF",
    href: "split.html",
    blurb: "Pull out page ranges, pick single pages, or burst every page.",
    ready: true,
    nav: true,
    icon: stroke('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18" stroke-dasharray="3 3"/>')
  },
  {
    id: "rotate",
    name: "Rotate PDF",
    href: "rotate.html",
    blurb: "Turn pages the right way up, all at once or one at a time.",
    ready: true,
    nav: true,
    icon: stroke('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/>')
  },
  {
    id: "organize",
    name: "Organize pages",
    href: "organize.html",
    blurb: "Drag pages into a new order and delete the ones you don't want.",
    ready: true,
    nav: true,
    icon: stroke('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>')
  },
  {
    id: "page-numbers",
    name: "Page numbers",
    href: "page-numbers.html",
    blurb: "Stamp page numbers anywhere on the page, in any size.",
    ready: true,
    nav: false,
    icon: stroke('<path d="M9 3 7 21M17 3l-2 18M4 8.5h16M3 15.5h16"/>')
  },
  {
    id: "watermark",
    name: "Watermark",
    href: "watermark.html",
    blurb: "Lay text or an image over every page, tiled or centred.",
    ready: true,
    nav: false,
    icon: stroke('<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z"/>')
  },
  {
    id: "jpg-to-pdf",
    name: "JPG to PDF",
    href: "jpg-to-pdf.html",
    blurb: "Turn photos into a PDF, one image per page.",
    ready: true,
    nav: false,
    icon: stroke('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>')
  },
  {
    id: "pdf-to-jpg",
    name: "PDF to JPG",
    href: "pdf-to-jpg.html",
    blurb: "Save every page as a JPG image, zipped up for download.",
    ready: true,
    nav: false,
    icon: stroke('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>')
  }
];

export const byId = id => TOOLS.find(t => t.id === id);
