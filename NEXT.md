# IlikePDF — what to do next

*Written for a Claude session starting cold on this repo. Read this, then
`README.md` for the conventions. `CLAUDE_CODE_HANDOFF.md` is the original spec —
every phase in it is now shipped, so treat it as history, not a task list.*

---

## Where things stand

All eight tools in `js/core/tools.js` are `ready: true` and working. **460
assertions across 9 smoke suites, green against both source and the built
`dist/`.**

```sh
npm install && npx playwright install chromium
npm run serve &            # source, port 8000
npm test                   # 460 assertions
npm run build              # -> dist/ + dist.zip, prints the size table
npm run preview &          # dist/, port 8001
BASE=http://localhost:8001 npm test    # same suites against the build
```

Per-suite counts, so you can tell at a glance if something got dropped:
`home 38 · merge 51 · split 71 · rotate 53 · organize 74 · page-numbers 41 ·
watermark 51 · jpg-to-pdf 35 · pdf-to-jpg 46`.

`npm test` chains with `&&`, so the first suite to fail hides every suite after
it. If something goes red, run the rest individually before concluding it's the
only thing broken.

**The build is honest and enforced.** Order is minify → inline → brotli, so the
`.br` files are compression of already-minified bytes; nothing is double-handled.
Worst page is `watermark.html` at **12,594 B brotli against a 14,336 B budget
(88%)**, and `build.mjs` exits non-zero if any page misses.

Measured, in case anyone proposes dropping minification because "brotli does it
anyway" — it does, mostly, but not enough:

| watermark.html | raw | gzip | brotli |
|---|---|---|---|
| unminified | 59,140 | 16,072 | 14,119 |
| minified | 41,942 | 13,812 | 12,209 |
| minifying saves | 17,198 | 2,260 | **1,910 (13.5%)** |

Unminified, the worst page lands at 98% of budget. Minification is buying
headroom for the next feature, not bandwidth.

---

## Phase 9 — Three defects — DONE (2026-07-29)

All three fixed, each with assertions that were confirmed failing first. Two of
the three write-ups above were wrong about the mechanism; both corrections are
recorded here because they are the kind of thing that gets re-derived otherwise.

### 9.1 Export failures are invisible in Watermark and Split — fixed

As diagnosed. `catch` set the message, `finally` called `update()`, `update()`
overwrote it. Both tools now keep a `failure` module variable that `update()`
renders first — `failure || imageError` in `watermark.js`, `failure || error ||
note` in `split.js` — so the message is part of what the view renders rather
than something written behind its back.

`failure` is cleared at the start of each attempt, on intake, and on restart.
Watermark also clears it in `useImage()`: without that, a stale failure outranks
"that isn't a PNG or JPG" from the next image picked, which is the same class of
bug one layer up.

Three assertions per suite (`split.smoke.mjs` §11, `watermark.smoke.mjs` §10).
They patch `window.PDFLib.PDFDocument.load` to throw. Two things they have to
get right: pdf-lib must already be on the page, so they export once and then use
`#restartBtn` rather than reloading, which would discard the patch; and the
deliberate `console.error` has to be discounted from the harness's error list
(`errors.length = mark`) or the correct behaviour fails "no console errors".

### 9.2 Watermark can't draw non-Latin text — fixed, with the honest message

`canDraw()` in `js/core/helvetica.js` gates the action button, which now reads
"Helvetica can't draw those characters".

**The write-up was wrong that helvetica.js "already knows the encodable range".**
It only carried ASCII 32–126 and fell back to the width of "n" for everything
else, so the WinAnsi high range had to be added: `0xA0–0xFF` plus the 27
non-contiguous code points WinAnsi rearranges (curly quotes, the dashes, €, …).
Getting that list right is the whole job — a predicate that is too strict would
refuse ordinary European text, which is worse than the bug it fixes, so
`watermark.smoke.mjs` asserts both directions (`日本語テキスト` refused,
`Café — naïve` allowed).

Cost: **+156 B brotli** on `watermark.html`, now 12,415 of 14,336 (87%). Every
other page is byte-identical, which confirms esbuild keeps `canDraw` off the
eight pages that don't import it.

**Still deferred: font embedding.** See 12.2 — there is a TODO in
`helvetica.js` pointing at it.

### 9.3 `.htaccess` can 500 the whole site — fixed, but not the suggested way

**The suggested fix would not have worked.** `<IfModule mod_autoindex.c>` asks
whether a *module is loaded*; the 500 comes from `AllowOverride` not permitting
the `Options` directive, which `<IfModule>` has no bearing on. A host that
withholds `AllowOverride Options` still returns 500 with the wrapper in place.

So the line is gone rather than wrapped, and `DirectoryIndex index.html` went
with it — that one needs `AllowOverride Indexes`, another permission class, and
`index.html` is mod_dir's built-in default anyway. What remains is one coherent
rule: **everything in the generated `.htaccess` needs `AllowOverride FileInfo`
and is guarded for module presence.** The comment at the top of `htaccess()`
says so, including why `Options -Indexes` must not come back.

`build.mjs` now writes a one-line `dist/vendor/index.html`, which is what
actually stops the listing — `vendor/` was the only directory without an index.
It is written directly, not through the page loop, so it stays out of the size
table.

---

## Phase 10 — Test against PDFs that weren't made by us

**This is the real gap.** Every fixture in `tests/fixtures/` is generated by
`make.py`: a 595×842 page with one line of Helvetica and a rule. No embedded
fonts, no images, no compression, no forms, one to sixty pages. The suites prove
the *logic* is right and prove almost nothing about real files.

Collect a handful of genuinely different PDFs and run all eight tools over each:

| kind | what it would break |
|---|---|
| scanned document (big JPEG per page) | memory during PDF→JPG at 3×; thumbnail render time |
| CJK or Cyrillic with embedded fonts | page-numbers/watermark drawing over it (should be fine — different code path from 9.2, verify) |
| 300+ pages | `IntersectionObserver` queue, `copyPages` cost, progress bar responsiveness |
| a fillable form (AcroForm) | pdf-lib `copyPages` drops form fields — split/organize would silently lose them |
| password-protected | the "name the file" error path (`ignoreEncryption: true` may open it anyway) |
| PDF/A or a linearised file | nothing expected, but worth one run |

**The AcroForm case is the one I'd bet on breaking.** `copyPages` doesn't carry
form field widgets across, so Split and Organize would hand back a document that
looks right and has lost every field. If that's confirmed, the fix is not to
implement form copying — it's to **detect it and say so** ("this PDF has form
fields; they won't survive being split"), consistent with how this project
handles things pdf-lib can't do.

Do **not** commit large binary fixtures. Test manually, write down what happened
in this file, and only add a fixture if it's small and reproducible.

---

## Phase 11 — Deployed and verified (2026-07-30)

Live at **https://ilikepdf.muriacare.my.id** — Apache 2.4.58 on Ubuntu, docroot
`/root/ilikepdf`, `AllowOverride All`. The `.htaccess` is no longer untested by
construction, and testing it immediately found two bugs in it.

### Both failure modes in the old warning actually happened

The first deploy served **binary garbage**, exactly as this file predicted. Two
independent causes, and neither is visible from a status code — the site
returned 200 throughout.

**1. mod_headers was not enabled.** `mod_rewrite` was, so the rewrite happily
served `pdf.min.js.br` while the `<IfModule mod_headers.c>` block — the thing
that adds `Content-Encoding: br` — was skipped entirely. The browser got brotli
bytes labelled `application/javascript`. This is the default Ubuntu Apache
install, not an exotic host: **mod_rewrite is enabled out of the box and
mod_headers is not.**

The old `.htaccess` guarded the two modules *independently*, which quietly
assumed that rewriting without labelling was a survivable state. It isn't — it
is the one combination that must never happen. The rewrite now lives **inside**
the mod_headers guard, so a host with one and not the other serves plain files.

**2. mod_deflate re-compressed the pre-compressed response.** Even with
mod_headers on, `AddOutputFilterByType DEFLATE text/html …` (Ubuntu's default
`deflate.conf`) gzipped the `.br`/`.gz` payload a second time while
`Content-Encoding` still claimed one layer. The tell was a served
`Content-Length` of 89,039 for an on-disk `.gz` of 89,006 — bigger, because
gzipping gzip does not compress. Browsers send `gzip, deflate, br`, so this hit
every request, not an edge case.

Fixed by setting `no-gzip` and `no-brotli` on the rewrite itself
(`[E=no-gzip:1,E=no-brotli:1]`). It has to be done there: `SetEnvIf` sees the
original URI, before the rewrite, so it never matches the `.br` name.

### Server-side changes made

Only one, and it is global to the box (which also hosts `muriacare.my.id`):

```sh
a2enmod headers && apache2ctl configtest && systemctl reload apache2
```

`mod_brotli` is loaded but its `brotli.conf` is **not** symlinked into
`mods-enabled`, so there is no on-the-fly brotli. That is deliberate and should
stay that way — every text file ships a `.br` built at quality 11, on-the-fly
would be quality 5 and cost CPU per request, and adding the filter re-opens the
double-compression hole above.

### Verified against the live site

```sh
curl -sI -H 'Accept-Encoding: gzip, deflate, br' https://ilikepdf.muriacare.my.id/watermark.html
#   Content-Encoding: br · Content-Length: 12259 · Cache-Control: no-cache
```

- `Content-Length` matching the on-disk `.br` byte-for-byte is the check that
  catches double compression. When it was broken the response was chunked with
  no `Content-Length` at all, which is easy to skim past.
- All three encodings (`identity`, `br`, `gzip`) decode to identical bytes
  across pages, favicon and vendor bundles.
- Hashed vendor files return `immutable`; `.html` returns `no-cache`.
- `vendor/` serves its index instead of a listing, with vhost `Options Indexes`
  on — which is what 9.3 traded the `Options -Indexes` line for.
- **All 460 assertions pass against the live site.** The suites take any
  `BASE`, and pointing them at production is the cheapest end-to-end check
  there is — it exercises the brotli path, real TLS, and pdf.js actually
  rendering, none of which `python3 -m http.server` can tell you:

```sh
BASE=https://ilikepdf.muriacare.my.id npm test
```

Deploy is a staged swap, so `.html` and `.html.br` are never briefly out of
step with each other:

```sh
npm run build
tar -czf dist.tar.gz -C dist .          # -C dist . so .htaccess is included
scp dist.tar.gz root@HOST:/tmp/
ssh root@HOST 'set -e
  rm -rf /root/ilikepdf.new && mkdir -p /root/ilikepdf.new
  tar -xzf /tmp/dist.tar.gz -C /root/ilikepdf.new
  mv /root/ilikepdf /root/ilikepdf.bak-$(date +%Y%m%d-%H%M%S)
  mv /root/ilikepdf.new /root/ilikepdf'
```

Rolling back is `mv` in the other direction; the previous deploy is kept as
`/root/ilikepdf.bak-*`. Clear old ones out occasionally, each is ~3.5 MB.

### Still worth doing

- **`DocumentRoot /root/ilikepdf`.** It works because `/root` is `drwx--x`, but
  serving out of root's home is a sharp edge — one `chmod` and the whole home
  directory is public. `/var/www/ilikepdf` costs nothing to move to.
- The error log is full of `wp-login.php` probes. Harmless against a static
  site, just noise.

## Phase 12 — What Phase 9 turned up

### 12.1 A rebuild threw away the user's focus — DONE (2026-07-29)

Found by running the full suite after Phase 9. Pre-existing: reproduced on a
clean checkout with the Phase 9 work stashed.

**The first diagnosis, written here, was wrong.** It blamed
`find(item.id)?.focus()` in the keydown handler returning undefined. It doesn't
— that chain is entirely synchronous (`reorder` → `store.moveTo` →
`notifyChange` → `grid.refresh()`), so the new tile is always in the DOM by the
time focus is restored, and the reorder itself always succeeded.

**What actually happened.** `merge.js:88` hydrates each entry's page count and
thumbnail asynchronously and calls `notifyChange` on each one. Every one of
those is a full `grid.refresh()` — `el.replaceChildren()` — arriving *after* the
keypress had already put focus in the right place. The rebuild destroyed the
focused tile and focus fell to `<body>`. The cascade explains the rest: with
focus on the document, the next arrow key went nowhere, so "arrow left moves it
back" failed too.

That is why it was intermittent against source and green against `dist/` — the
inlined build finishes hydrating before the keyboard section starts; source,
fetching a dozen modules separately, does not. Waiting for hydration to settle
before pressing a key made it pass every time, which is what pinned it.

So it was never really a test bug. **A keyboard user reordering files lost their
place whenever a thumbnail finished loading.**

**Fix.** `grid.refresh()` now preserves focus across the rebuild, in
`focusMemo()` / `restoreFocus()`. Position already survived via FLIP and
thumbnails via the cache; focus is the third thing that has to, and it belongs
in the same place rather than in each caller. Notes on the shape of it:

- It only ever restores focus that was **already inside this grid**. A refresh
  fired by a background thumbnail must not yank the caret out of a text field
  somewhere else on the page.
- It restores to a button within the tile when that is where focus was — the ✕
  and the touch ← → carry `data-action`, and they are rebuilt too.
- It restores with `preventScroll: true`. Putting focus back where it already
  was has no business moving the viewport. The keydown handler still calls a
  plain `focus()` afterwards, which is the deliberate-move case: the user asked
  for it, so the tile they moved is scrolled into view.

**Cost:** ~179 B brotli on every tool page, since `grid.js` is on all eight.
Worst page `watermark.html` is now 12,594 of 14,336 (88%).

**Two new assertions** in `merge.smoke.mjs` force the rebuild on demand by
adding a file, rather than waiting on the race. They fail deterministically
without the fix — as do the three original ones, which is the useful part: the
suite is now honest about this instead of intermittent.

### 12.2 Watermark font embedding

Deferred from 9.2, which shipped the honest message instead. There is a TODO in
`js/core/helvetica.js` next to `canDraw()`.

Let users supply a `.ttf` and call `registerFontkit` + `embedFont`, which draws
anything. Costs `@pdf-lib/fontkit` (~140 KB) and a file input, against about
1.9 KB of remaining budget on `watermark.html`. **Only if someone asks** — until
then the button says what it can't do, which is honest and free.

---

## Deliberately not doing

Keep saying no to these; they're in `README.md` too, and the reasons haven't
changed.

- **Compress PDF.** pdf-lib can strip metadata and re-save with
  `useObjectStreams: true`. That is low single-digit percentages. It is not what
  anyone means by "compress a PDF", and shipping it would be a lie.
- **Word/Excel conversion.** Not possible client-side. Both conversion pages say
  so in `.hero-note` — leave that text in.
- **Encryption / password removal.** pdf-lib can only *ignore* existing
  encryption on load, never apply it.

If a future request seems to need one of these, say so plainly rather than
shipping a placeholder that pretends to work.

---

## Things that will bite you

Learned the hard way; all of these are load-bearing.

- **`.slice()` into pdf-lib and pdf.js, always.** Both detach the buffer, and
  the second read then fails silently — including "export twice in a row".
- **Preview and export must agree.** The watermark tile count is computed from
  `js/core/helvetica.js`, which carries pdf-lib's own AFM widths so the number of
  marks previewed is the number drawn. Regenerate with
  `node tests/fixtures/make-metrics.mjs` if the pdf-lib pin ever changes. Don't
  substitute an estimate — a preview showing 22 marks where 12 land is worse
  than no preview.
- **Anything drawn on a page needs `js/core/place.js`.** pdf-lib draws in a
  page's *unrotated* space; a corner is not a fixed pair of coordinates.
  `tests/fixtures/prerotated.pdf` is the regression case.
- **`grid.js` decoration must happen in `decorate()`, never at tile
  construction.** A late-arriving thumbnail calls `replaceChildren` on
  `.thumb-box` and destroys anything built up front.
- **`refresh()` is called by things the user didn't do.** Tools hydrate entries
  in the background and notify per entry, so a rebuild can land at any moment.
  Anything that has to survive one belongs *inside* `refresh()`, not in the
  caller that happened to trigger it — position (FLIP), thumbnails (the cache)
  and focus (`focusMemo`/`restoreFocus`) all work that way. 12.1 was the cost of
  focus not being on that list.
- **Vendor paths in source must stay literal and relative** (`"vendor/pdf.min.js"`,
  never built from a variable). The build rewrites them to hashed names with a
  string replace and *throws* if any survive — which is what keeps `dist/`
  working from a subdirectory.
- **Run the whole suite, not just the one you touched.** The core modules are
  shared; a change for one tool has broken another in phases 1, 2, 4 and 5.

---

## Suggested order

```
9    all three defects      DONE      2026-07-29
12.1 focus across rebuild   DONE      2026-07-29
11   deploy + verify        DONE      2026-07-30  (found 2 more .htaccess bugs)
10   real-world PDFs        open      the actual unknown, and now the only one
12.2 font embedding         open      only if someone asks
```

**10 is what's left.** Everything else is either shipped or explicitly parked.
It stays open-ended because it is discovery, not a task with a finish line —
expect it to generate its own phase 13.

The lesson from 11, worth carrying into 10: the `.htaccess` was reviewed twice
and looked right both times, and it was still wrong in two ways that only a real
Apache could show. Phase 10 is the same shape of gap — fixtures we generated
ourselves cannot tell us what real PDFs do.

One thing worth knowing before you start a server: something else may already
hold port 8000 (a `php -S localhost:8000` was running during Phase 12). `npm run
serve` fails with "address in use" and the suites then quietly test *whatever is
on that port* instead. If results stop making sense, check what you are actually
talking to before you debug the code:

```sh
curl -s http://localhost:8000/js/core/grid.js | head -1    # should be JS, not HTML
```
