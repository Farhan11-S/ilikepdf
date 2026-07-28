# IlikePDF — Handoff spec for Claude Code

## 1. What already exists

`ilikepdf.html` — one file, no build step, two CDN scripts:

- `pdf-lib@1.17.1` (from cdnjs) — merging
- `pdf.js@3.11.174` (from cdnjs) — first-page thumbnails

### Current behaviour
1. **Hero** → "Select PDF files" button, or drop files anywhere on the page.
2. **Workspace** → card grid on the left, sticky red action panel on the right.
3. Cards show a rendered thumbnail, filename, page count, size. Hover reveals a remove
   button; touch devices get ← → reorder buttons instead of HTML5 drag.
4. Reordering uses **FLIP** animation (measure rects → re-render → invert transform →
   animate to zero) so cards glide rather than jump.
5. **Merge** copies pages with `out.copyPages(src, src.getPageIndices())` in array order,
   shows a progress bar, then a success screen with a download button.

### Things worth knowing before you touch it
- The pdf.js worker is fetched and turned into a **blob URL** because a cross-origin
  worker can fail. Keep that fallback.
- File bytes are stored as `Uint8Array`. Always pass `.slice()` into pdf-lib and pdf.js —
  both can detach the underlying buffer, and the second read then fails silently.
- `render()` rebuilds the whole grid every time. That's fine at this scale; FLIP hides it.
- `files` is the single source of truth: `{id, name, size, bytes, pages, thumb}`.
  Array order **is** output order.

### Design tokens (already in `:root`, do not invent new ones)
```
--red #e5322d   --red-dark #c9241f   --ink #33333d   --ink-soft #6b6b76
--line #e8e6e9  --bg #ffffff        --canvas #f7f5f6  --radius 8px
```
System font stack. Buttons use a hard `box-shadow` bottom edge that compresses on
`:active`. Cards pop in with a stagger. `prefers-reduced-motion` kills all animation —
keep honouring it.

---

## 2. Phases

Each phase ends with: Merge still works, no console errors, keyboard focus visible,
usable at 375px wide.

### Phase 0 — Project structure
Break the single file into a real project **without adding a build step** (native ES
modules, `<script type="module">`):

```
index.html            tool directory / landing
merge.html            Merge PDF
css/tokens.css        variables, reset, buttons
css/app.css           header, hero, workspace, cards, panel
js/core/store.js      file list state + subscribe
js/core/dropzone.js   page-wide drag & drop + overlay
js/core/thumbs.js     pdf.js init + first-page render
js/core/grid.js       card grid, FLIP reorder, remove
js/core/panel.js      right panel, progress bar, error text
js/core/download.js   blob download helper
js/tools/merge.js     merge logic only
```
Also add `README.md` and `.gitignore`, and `git init` if needed.
Acceptance: `merge.html` is byte-for-byte equivalent in behaviour to the prototype.

### Phase 1 — Landing page
`index.html` with the tool grid iLovePDF-style: card per tool, icon, name, one-line
description. Tools not built yet are visibly disabled, not hidden. Header nav links to
real pages. Shared header/footer via a tiny `js/core/chrome.js` that injects them.

### Phase 2 — Split PDF (`split.html`)
Page-level grid instead of file-level: render **every** page as a thumbnail.
Three modes in the panel:
- **Range** — one or more custom ranges (`1-4`, `7`, `9-12`), each becomes a file
- **Extract pages** — pick pages by clicking their thumbnails
- **Every page** — one PDF per page

Multiple outputs need a ZIP: add `jszip` from cdnjs. Single output downloads directly.
pdf-lib: `PDFDocument.create()` + `copyPages(src, [indices])`.
Watch memory — render page thumbnails lazily with `IntersectionObserver`.

### Phase 3 — Rotate PDF (`rotate.html`)
Page grid again. Rotate-all buttons (left / right) plus per-page rotate on hover.
Thumbnails must animate the rotation visually before export.
pdf-lib: `page.setRotation(degrees((page.getRotation().angle + 90) % 360))`.

### Phase 4 — Organize pages (`organize.html`)
Reuse the FLIP grid from Phase 0, but on pages instead of files: drag to reorder,
click to delete, undo button. Accepts multiple input PDFs merged into one working set.
This is the phase where `js/core/grid.js` should get generic enough to take any
`{id, thumbCanvas, label}` item — refactor it, don't fork it.

### Phase 5 — Page numbers & watermark
- **Page numbers**: position (6 anchor points), font size, starting number, "skip first page".
  Use `page.drawText` with a standard font.
- **Watermark**: text or an uploaded PNG/JPG, opacity, rotation, tiled or centred.
  `embedPng` / `embedJpg` + `drawImage` with `opacity`.

### Phase 6 — Conversions
- **JPG → PDF**: images in, one page each, with fit / A4 / margin options.
- **PDF → JPG**: pdf.js render at 2× scale → `canvas.toBlob` → ZIP.
Be explicit in the UI that these are the only conversions available — Word/Excel
conversion is not possible client-side, so don't stub it in the tool grid.

### Phase 7 — Polish and ship
- Error states: password-protected PDFs (`PDFDocument.load` throws — catch and name the
  file that failed), 0-byte files, non-PDF drops, files over ~100MB (warn, don't block).
- A11y pass: the drag grid needs a keyboard path (arrow keys move focused card).
- Persist nothing; add a short "your files stay on your device" note in the footer.
- Playwright smoke test per tool if you want tests: load fixture PDFs, run the tool,
  assert the downloaded byte count is non-zero.
- Deploy: it's static, so GitHub Pages works. Add the workflow file.

---

## 3. Out of scope — don't let the model try these

pdf-lib **cannot**:
- encrypt or password-protect a PDF (it can only *ignore* existing encryption on load)
- meaningfully compress — no image downsampling or stream re-encoding.
  If you want a "Compress" tool, be honest: it strips metadata and re-saves with
  `useObjectStreams: true`, which saves single-digit percentages. Label it accurately
  or skip it.
- extract or edit text content
- convert to or from Office formats

If a phase seems to require one of these, stop and say so rather than shipping a
placeholder that pretends to work.

---

## 4. Prompt snippets for later sessions

Resuming cold:
```
Read CLAUDE_CODE_HANDOFF.md, then `git log --oneline` and tell me which phase
we're on and what's left in it. Don't write code yet.
```

Mid-phase debugging:
```
Split PDF produces a 0-byte file when I pick "every page". Reproduce it against
tests/fixtures/, find the cause, and explain it before you fix it.
```

Design consistency check:
```
Compare rotate.html against merge.html. List every place rotate.html invents a
style, spacing value, or interaction that merge.html doesn't already have,
then align them to the tokens in css/tokens.css.
```
