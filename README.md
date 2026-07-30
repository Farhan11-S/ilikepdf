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

Any static server works and the source needs no build step. Nothing is fetched
from the network at runtime either: the four libraries are committed in
`vendor/`. `package.json` pins their versions and drives the tests below.

## Testing

Headless-browser smoke tests drive the real UI — one suite per tool, plus
`home.smoke.mjs` for the landing grid and injected chrome. They assert on what
came out, not just that something did: downloads are unzipped and read back with
pdf.js to check page counts, page order, and page rotation. Run them after every
change; the core modules are shared, so a change for one tool can break another.

```sh
npm install && npx playwright install chromium
python3 -m http.server 8000 &
npm test
```

`BASE` overrides the URL, `CHROME` overrides the browser binary. Point `BASE` at
the preview server to run the same suites against the built site:

```sh
npm run build && npm run preview &
BASE=http://localhost:8001 npm test
```

The harness records every response of 400 or worse as an error, so a path the
build rewrote wrongly fails whatever suite loads that page. That is the main
risk of building at all, and the reason the whole suite runs against `dist/`.

## Building and deploying

Source is directly servable and stays that way; the build only produces the
upload.

```sh
npm run build     # -> dist/ and dist.zip
```

Upload the contents of `dist/` — or `dist.zip`, if the host only offers a file
manager. Nothing else needs to go up.

The target is one round trip to first paint: **every file under 14,336 bytes
compressed**, roughly what TCP's initial congestion window carries before it has
to wait for an acknowledgement. The build prints a raw/gzip/brotli table and
**fails** if a page misses it — a budget nobody enforces is a wish.

What it does:

- Bundles all nine page entries with esbuild in one pass, so what more than one
  page uses is lifted into **content-hashed shared chunks** served from `js/`.
  Each page inlines its own remaining JS and the shared CSS; the chunks are
  cached for a year, so the core is downloaded once for the whole site.
- **The budget is per connection, not per file.** TCP's congestion window
  belongs to the connection, so two 7 KB files are not two round trips' worth of
  headroom — the second can't even be requested until the first arrives. What
  splitting buys is cache reuse across pages, not a bigger first window. First
  paint is unchanged (CSS inline, module scripts deferred); time to interactive
  is one round trip later on a first visit.
- Gives each `vendor/` file a content-hashed name and rewrites the references —
  which is a string replace, and why the paths in source are literal, relative
  and never built up from variables.
- Writes `.br` and `.gz` beside every text file. Shared hosting often has no
  `mod_brotli`, but Apache will serve a copy we compressed ourselves.
- Emits an `.htaccess` that serves those by `Accept-Encoding`, caches the hashed
  vendor files and shared chunks for a year and the pages not at all, and wraps
  every block in
  `<IfModule>` so a host missing a module serves plain files instead of a 500.

Paths are relative throughout, so `dist/` works from a subdirectory as well as a
domain root — including the chunk imports, which is worth re-checking if that
path layer ever changes.

If a page ever busts the budget again, the shared **CSS** is the next lever
(3,850 B on every page). Do it knowing it is a worse trade than the JS split
was: CSS is render-blocking, so extracting it costs a round trip to *first
paint* rather than to interactive.

## Tools

The registry in `js/core/tools.js` is the single source of truth — the landing
grid, the header nav, and the footer all read from it. Adding a tool means
adding a row there and flipping `ready`.

| Tool | Page | Status |
|------|------|--------|
| Merge PDF | `merge.html` | done |
| Split PDF | `split.html` | done |
| Rotate PDF | `rotate.html` | done |
| Organize pages | `organize.html` | done |
| Page numbers | `page-numbers.html` | done |
| Watermark | `watermark.html` | done |
| JPG to PDF | `jpg-to-pdf.html` | done |
| PDF to JPG | `pdf-to-jpg.html` | done |

There is deliberately no Compress or Office-conversion tool — see the last
section for why.

## Layout

```
index.html          tool directory
merge.html          Merge PDF
split.html          Split PDF
rotate.html         Rotate PDF
organize.html       Organize pages
page-numbers.html   Add page numbers
watermark.html      Watermark
jpg-to-pdf.html     JPG to PDF
pdf-to-jpg.html     PDF to JPG
favicon.svg
vendor/             the four libraries, committed
build.mjs           builds dist/ — inlines, hashes, compresses, checks the budget
scripts/vendor.mjs  refreshes vendor/ from node_modules
dist/               build output, gitignored — the only thing uploaded
dist/js/            content-hashed shared chunks, cached a year
css/tokens.css      design tokens, reset, button primitives
css/app.css         header, footer, hero, tool grid, workspace, cards, panel
js/core/tools.js    the tool registry
js/core/chrome.js   injects the shared header + footer
js/core/store.js    file list state + subscribe
js/core/dropzone.js page-wide drag & drop + overlay
js/core/libs.js     loads the vendored libraries on demand
js/core/busy.js     the bottom-right busy pill
js/core/thumbs.js   pdf.js setup + page rendering
js/core/place.js    anchors and rotated-page coordinates
js/core/helvetica.js  text metrics, for measuring without pdf-lib
js/core/forms.js    AcroForm/signature detection + the warnings tools show
js/core/images.js   reading images in and embedding them
js/core/grid.js     the one grid: cards or page tiles, lazy, FLIP reorder
js/core/panel.js    action panel, progress bar, error text
js/core/ranges.js   "1-4, 7, 9-12" parsing
js/core/format.js   file sizes, pluralisation, base filenames
js/core/download.js blob download helper
js/tools/home.js    landing page tool grid
js/tools/merge.js   merge logic
js/tools/split.js   split logic
js/tools/rotate.js  rotate logic
js/tools/organize.js reorder/delete logic
js/tools/page-numbers.js  page number stamping
js/tools/watermark.js     watermark stamping
js/tools/jpg-to-pdf.js    images in, one page each
js/tools/pdf-to-jpg.js    pages out, as JPG or PNG
tests/              browser smoke tests + PDF fixtures
tests/real-corpus.json  manifest of third-party PDFs for the phase 10 sweep
tests/real.probe.mjs    every tool over every real PDF — not part of npm test
scripts/fetch-real.mjs  downloads that manifest into tmp/real/ (gitignored)
```

### Testing against PDFs we didn't make

The fixtures in `tests/fixtures/` are ones we generated, which makes them good
at proving logic and bad at predicting real files — see NEXT.md phase 10, where
a self-made fixture confirmed a mechanism and was wrong about what it meant.

```sh
npm run fetch-real     # manifest -> tmp/real/, sha256 checked
npm run probe:real     # sweeps every tool over every file, writes tmp/real-report.md
```

Neither runs in `npm test`: the suites must pass on a clean checkout with no
network. Drop any PDF into `tmp/real/` and the sweep picks it up.

Every page carries empty `<header class="site-header">` and
`<footer class="site-footer">` shells that `chrome.js` fills in. The shells stay
in the HTML so the 64px sticky header keeps its height and position before any
script runs — injecting the whole element would make the page jump on load.

## Libraries

All four live in `vendor/`, committed, so a fresh clone works offline. They are
copied out of `node_modules` by `npm run vendor`; the versions are pinned exactly
in `package.json`, which is what makes `package-lock.json` the real pin.

- **pdf-lib 1.17.1** — all PDF *writing*. `PDFLib` global.
- **pdf.js 3.11.174** — preview rendering only. `pdfjsLib` global.
- **JSZip 3.10.1** — only when a result is more than one file. `JSZip` global.
- **@pdf-lib/fontkit 1.1.1** — only when someone supplies their own watermark
  font. `fontkit` global. **The biggest file here at 758 KB raw / 266 KB
  brotli**, larger than pdf-lib itself, which is exactly why nothing loads it
  unless asked. It buys the one thing Helvetica cannot do: any script at all.

They are **not** loaded up front. `js/core/libs.js` injects each one on first
use and caches the promise, because half a megabyte of JavaScript blocking a
page whose first act is "pick a file" bought nothing: pdf-lib is only needed at
Export, JSZip only for a multi-file result, and pdf.js only once there is a
document to preview. JPG→PDF never loads pdf.js at all.

They stay classic scripts exposing globals on purpose — that is what the
vendored UMD builds are, and the smoke tests read results back through those
globals inside `page.evaluate`. `window.ilikepdf.loadPdfJs()` (and `loadZip`,
`loadPdfLib`) is how anything outside the page awaits one.

Vendoring also removed the runtime CDN dependency: a blocked or slow CDN used to
take every tool down with it, and pdf.js's worker no longer needs the blob-URL
workaround it carried only because it was cross-origin.

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
- `grid.js` is the only grid. It takes `{id, label, meta, thumb}` items and knows
  nothing about what they are; tools opt into `render` (lazy thumbnails),
  `reorder` (drag + FLIP), `onRemove`, `onToggle`, `controls` and `describe`.
  A tile is either a button you click (`onToggle`) or a plain element holding
  buttons (`controls`/`onRemove`) — never both, since nesting buttons isn't valid
  HTML, and passing both throws.
- Rendered thumbnails are cached by item id, so reordering never re-renders.
  `reset()` clears the cache when a different document is loaded.
- Anything reorderable needs three ways in, because each one leaves someone out:
  HTML5 drag (mouse), ← → buttons shown under `hover:none` (touch), and arrow
  keys on the focused tile (keyboard). `grid.js` provides all three whenever
  `reorder` is passed; a tool doesn't opt in separately.
- Rotation is applied on top of a page's existing `/Rotate`, never assigned
  outright. A page can arrive already rotated, and the thumbnail you turned was
  showing that rotation.
- **Text drawn with a standard font is WinAnsi only**, and pdf-lib *throws*
  rather than approximating. Watermark checks with `canDraw()` before enabling
  its button, and lets the user supply a `.ttf`/`.otf` when that isn't enough —
  which is embedded subset, so a 6 MB face costs a few KB in the output. A
  supplied font fails the other way, drawing blanks rather than throwing, so it
  is checked for glyph coverage instead. Both checks live in
  `missingGlyphs()` in `js/tools/watermark.js`.
- Anything *drawn* onto a page has the same problem in reverse: pdf-lib draws in
  the page's unrotated space, so a corner is not a fixed pair of coordinates.
  Do the arithmetic in visual space and convert with `js/core/place.js`.
- A file is checked with `store.inspect()` before anything tries to parse it:
  empty files get told they're empty rather than "possibly password-protected",
  and very large ones get a warning, never a refusal.
- Errors raised before a document is loaded go to `#heroError`, not the panel —
  the panel isn't on screen yet. `fail()` in each tool picks the right one.
- Use the tokens in `css/tokens.css`; don't invent new colours or radii.
- `prefers-reduced-motion` disables all animation. Keep it that way.

## What pdf-lib cannot do

Don't build UI that implies otherwise: it cannot encrypt or password-protect,
meaningfully compress, extract or edit text, or convert to/from Office formats.

It also **cannot copy a form**. `copyPages` carries a page's widget annotations
across but not the catalog's `/AcroForm`, so the fields arrive orphaned. The
widgets survive completely — values included — and a browser will still show
fillable boxes, so the result *looks* fine; what is gone is the document-level
form, and anything that reads or fills form data no longer sees one. Merge,
Split and Organize copy pages and so all three warn before they do it
(`js/core/forms.js`); Rotate, Page numbers and Watermark mutate the document in
place and keep the form intact. Don't add the warning to those three, don't be
tempted to "fix" it by implementing form copying, and **don't word the warning
as "the fields will be gone"** — they visibly aren't, and a real file disproved
exactly that phrasing. See NEXT.md 10.1.

It cannot **preserve a digital signature** either, and here there is no safe
tool: a signature covers a byte range, and pdf-lib re-saves the whole file. The
two groups fail differently — the page-copying tools remove the signature, the
in-place ones leave one that no longer verifies, which reads to a viewer as
"this document has been altered". All six PDF→PDF tools warn; PDF→JPG and
JPG→PDF don't, because an image cannot carry a signature. See NEXT.md 10.7.

That's why there is no Compress tool. All pdf-lib could do is strip metadata and
re-save with `useObjectStreams: true`, which saves low single-digit percentages —
not what anyone means by "compress". Word/Excel conversion isn't possible client
side at all. Neither appears in the tool registry, so neither is advertised.
