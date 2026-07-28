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

A headless-browser smoke test drives the real UI: add files, reorder, remove,
merge, download, then parses the downloaded PDF back to check its page count.
Merge is the tool everything else is built on, so run this after every change.

```sh
npm install && npx playwright install chromium
python3 -m http.server 8000 &
npm test
```

`BASE` overrides the URL, `CHROME` overrides the browser binary.

## Tools

| Tool | Page | Status |
|------|------|--------|
| Merge PDF | `merge.html` | done |
| Split PDF | — | planned |
| Rotate PDF | — | planned |
| Organize pages | — | planned |
| Page numbers / watermark | — | planned |
| JPG ↔ PDF | — | planned |

## Layout

```
index.html          tool directory
merge.html          Merge PDF
favicon.svg
css/tokens.css      design tokens, reset, button primitives
css/app.css         header, hero, workspace, cards, panel
js/core/store.js    file list state + subscribe
js/core/dropzone.js page-wide drag & drop + overlay
js/core/thumbs.js   pdf.js setup + page rendering
js/core/grid.js     card grid, FLIP reorder, remove
js/core/panel.js    action panel, progress bar, error text
js/core/download.js blob download helper
js/tools/merge.js   merge logic
tests/              browser smoke tests + PDF fixtures
```

## Libraries

Both are loaded from cdnjs as classic scripts, so their globals exist before any
module runs.

- **pdf-lib 1.17.1** — all PDF *writing*. `PDFLib` global.
- **pdf.js 3.11.174** — preview rendering only. `pdfjsLib` global.

pdf.js's worker is fetched and re-served as a blob URL, because a cross-origin
worker can be refused. `js/core/thumbs.js` keeps a fallback to the raw CDN URL.

## Conventions

- Vanilla JS and CSS. No framework, no bundler, no preprocessor.
- File bytes live in `store.js` as `Uint8Array`. **Always pass `.slice()`** into
  pdf-lib and pdf.js — both detach the underlying buffer, and the next read then
  fails silently.
- Order in the `store` array *is* output order.
- Use the tokens in `css/tokens.css`; don't invent new colours or radii.
- `prefers-reduced-motion` disables all animation. Keep it that way.

## What pdf-lib cannot do

Don't build UI that implies otherwise: it cannot encrypt or password-protect,
meaningfully compress, extract or edit text, or convert to/from Office formats.
