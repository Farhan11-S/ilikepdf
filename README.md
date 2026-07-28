# IlikePDF

Client-side PDF tools. Every file is read, processed, and written in the browser —
nothing is uploaded, nothing is stored, there is no backend.

## Running it

The site uses native ES modules, so it needs to be served over HTTP.
Opening the HTML files directly from disk (`file://`) will fail with a CORS error.

```sh
python3 -m http.server 8000
# then open http://localhost:8000/merge.html
```

Any static server works. The site has no build step and no runtime dependencies —
the `package.json` here exists only for the tests below.

## Testing

Headless-browser smoke tests drive the real UI. `tests/merge.smoke.mjs` adds
files, reorders, removes, merges and downloads, then parses the downloaded PDF
back to check its page count and page order. `tests/home.smoke.mjs` covers the
landing grid and the injected chrome. Merge is the tool everything else is built
on, so run these after every change.

```sh
npm install && npx playwright install chromium
python3 -m http.server 8000 &
npm test
```

`BASE` overrides the URL, `CHROME` overrides the browser binary.

## Tools

The registry in `js/core/tools.js` is the single source of truth — the landing
grid, the header nav, and the footer all read from it. Adding a tool means
adding a row there and flipping `ready`.

| Tool | Page | Status |
|------|------|--------|
| Merge PDF | `merge.html` | done |
| Split PDF | `split.html` | done |
| Rotate PDF | `rotate.html` | planned |
| Organize pages | `organize.html` | planned |
| Page numbers | `page-numbers.html` | planned |
| Watermark | `watermark.html` | planned |
| JPG to PDF | `jpg-to-pdf.html` | planned |
| PDF to JPG | `pdf-to-jpg.html` | planned |

There is deliberately no Compress or Office-conversion tool — see the last
section for why.

## Layout

```
index.html          tool directory
merge.html          Merge PDF
favicon.svg
css/tokens.css      design tokens, reset, button primitives
css/app.css         header, footer, hero, tool grid, workspace, cards, panel
js/core/tools.js    the tool registry
js/core/chrome.js   injects the shared header + footer
js/core/store.js    file list state + subscribe
js/core/dropzone.js page-wide drag & drop + overlay
js/core/thumbs.js   pdf.js setup + page rendering
js/core/grid.js     file card grid, FLIP reorder, remove
js/core/pagegrid.js page tile grid, lazily rendered
js/core/panel.js    action panel, progress bar, error text
js/core/ranges.js   "1-4, 7, 9-12" parsing
js/core/format.js   file sizes, pluralisation, base filenames
js/core/download.js blob download helper
js/tools/home.js    landing page tool grid
js/tools/merge.js   merge logic
js/tools/split.js   split logic
tests/              browser smoke tests + PDF fixtures
```

Every page carries empty `<header class="site-header">` and
`<footer class="site-footer">` shells that `chrome.js` fills in. The shells stay
in the HTML so the 64px sticky header keeps its height and position before any
script runs — injecting the whole element would make the page jump on load.

## Libraries

Both are loaded from cdnjs as classic scripts, so their globals exist before any
module runs.

- **pdf-lib 1.17.1** — all PDF *writing*. `PDFLib` global.
- **pdf.js 3.11.174** — preview rendering only. `pdfjsLib` global.
- **JSZip 3.10.1** — only on pages that can emit more than one file. `JSZip` global.

pdf.js's worker is fetched and re-served as a blob URL, because a cross-origin
worker can be refused. `js/core/thumbs.js` keeps a fallback to the raw CDN URL.

## Conventions

- Vanilla JS and CSS. No framework, no bundler, no preprocessor.
- File bytes live in `store.js` as `Uint8Array`. **Always pass `.slice()`** into
  pdf-lib and pdf.js — both detach the underlying buffer, and the next read then
  fails silently.
- Order in the `store` array *is* output order.
- Page grids render thumbnails lazily via `IntersectionObserver`, one at a time.
  A 500-page PDF is 500 canvases; don't render them eagerly.
- A tool that can produce several files downloads a single result directly and
  zips the rest. Don't hand someone a ZIP containing one file.
- Use the tokens in `css/tokens.css`; don't invent new colours or radii.
- `prefers-reduced-motion` disables all animation. Keep it that way.

## What pdf-lib cannot do

Don't build UI that implies otherwise: it cannot encrypt or password-protect,
meaningfully compress, extract or edit text, or convert to/from Office formats.

That's why there is no Compress tool. All pdf-lib could do is strip metadata and
re-save with `useObjectStreams: true`, which saves low single-digit percentages —
not what anyone means by "compress". Word/Excel conversion isn't possible client
side at all. Neither appears in the tool registry, so neither is advertised.
