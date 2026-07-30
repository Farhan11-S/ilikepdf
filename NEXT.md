# IlikePDF — working notes

*The one document for anyone picking this up cold. `README.md` answers "what is
this and how do I run it"; this answers "what will bite me, and what happened
already". There used to be a `CLAUDE_CODE_HANDOFF.md` holding the original spec
for a single-file `ilikepdf.html` with CDN scripts — every phase in it shipped,
and parts of it had gone actively wrong, so it is gone.*

---

## Where things stand

All eight tools in `js/core/tools.js` are `ready: true` and working.
**548 assertions across 10 suites against source, 555 against `dist/`** — the
extra seven are build-only markup (prefetch links, speculation rules) that
doesn't exist in source.

```sh
npm install && npx playwright install chromium
npm run serve &                        # source, port 8000
npm test                               # 548
npm run build                          # -> dist/ + dist.zip, prints the size table
npm run preview &                      # dist/, port 8001
BASE=http://localhost:8001 npm test    # 555
```

Per-suite, against source, so a dropped assertion is obvious:
`home 40 · merge 66 · split 86 · rotate 59 · organize 85 · page-numbers 44 ·
watermark 69 · jpg-to-pdf 35 · pdf-to-jpg 46 · mobile 18`.

`npm test` chains with `&&`, so the first failure hides every suite after it. If
something goes red, run the rest individually before concluding it's the only
thing broken.

**Before you start a server, check what is already on the port.** Something else
holding 8000 doesn't fail loudly — the suites quietly test whatever is there. It
cost a wrong diagnosis once.

```sh
curl -s http://localhost:8000/js/core/grid.js | head -1    # JS, not HTML
```

### The size budget

Every served file under **14,336 bytes brotli**, roughly TCP's initial
congestion window. `build.mjs` exits non-zero if a page misses. Worst page is
`watermark.html` at **8,206 B (57%)**.

**The window belongs to the connection, not the file.** Splitting one 13 KB
response into two 7 KB ones buys no second window — both draw on the first, and
the second can't be requested until the first arrives. "Every file under 14 KB"
is a weaker property than "the page arrives in one round trip"; only the first
is still true. Production is HTTP/1.1, so there's no multiplexing either.

Pages inline their own JS and the shared CSS; what more than one page uses lives
in content-hashed chunks under `dist/js/`, cached a year. `index.html` is the
exception and is built unsplit — see 12.4.

---

## Things that will bite you

All learned the hard way, all load-bearing.

- **`.slice()` into pdf-lib and pdf.js, always.** Both detach the buffer and the
  second read then fails silently — including "export twice in a row".
- **Preview and export must agree.** The watermark tile count comes from
  `js/core/helvetica.js`, which carries pdf-lib's own AFM widths so the number
  of marks previewed is the number drawn. Regenerate with
  `node tests/fixtures/make-metrics.mjs` if the pdf-lib pin changes. A supplied
  font is measured against a `PDFFont` embedded in a throwaway document, for the
  same reason — never a second implementation that can drift.
- **Anything drawn on a page needs `js/core/place.js`.** pdf-lib draws in the
  page's *unrotated* space; a corner is not a fixed pair of coordinates.
  `tests/fixtures/prerotated.pdf` is the regression case.
- **`grid.js` decoration happens in `decorate()`, never at tile construction.** A
  late thumbnail calls `replaceChildren` on `.thumb-box` and destroys anything
  built up front.
- **`refresh()` is called by things the user didn't do.** Tools hydrate entries
  in the background and notify per entry, so a rebuild lands at any moment.
  Anything that must survive one belongs *inside* `refresh()`: position (FLIP),
  thumbnails (the cache), focus (`focusMemo`/`restoreFocus`).
- **A message the view doesn't own gets wiped.** Any panel text set outside the
  function that renders the panel will be destroyed by the next render. This has
  now caused three separate bugs (9.1, 12.2's watermark note, and Merge's
  hydration race). Keep it in a module variable the render function reads.
- **Vendor paths in source stay literal and relative** (`"vendor/pdf.min.js"`,
  never built from a variable). The build rewrites them by string replace and
  *throws* if any survive, which is what keeps `dist/` working from a
  subdirectory. The same is true of chunk paths — and those resolve against two
  different bases, see 12.3.
- **Run the whole suite, not just the one you touched.** The core modules are
  shared; a change for one tool has broken another in phases 1, 2, 4 and 5.
- **Assert *when*, not just *whether*.** Every suite passed through 12.3 while
  the landing page showed an empty box for 283 ms, because they all asked
  whether the grid rendered and never how long it took.

---

## What pdf-lib cannot do

Don't build UI that implies otherwise, and don't ship a placeholder that
pretends. If a request seems to need one of these, say so plainly.

- **Compress.** All it can do is strip metadata and re-save with
  `useObjectStreams: true` — low single-digit percentages. Not what anyone means
  by compressing a PDF.
  *(`copyPages` does drop unreferenced objects, which shrank one real 7.9 MB
  file to 0.1 MB pixel-identically. That is deletion of orphans, not
  compression, and it is entirely file-dependent. Do not turn it into a feature.)*
- **Word/Excel conversion.** Not possible client-side at all. Both conversion
  pages say so in `.hero-note` — leave that text in.
- **Encrypt or password-protect.** It can only *ignore* existing encryption on
  load, never apply it.
- **Copy a form.** `copyPages` carries the widgets but not the catalog's
  `/AcroForm` — see 10.1.
- **Preserve a signature.** Nothing can; a signature covers a byte range and
  every save rewrites it — see 10.7.

---

## Deploying

Live at **https://ilikepdf.muriacare.my.id** — Apache 2.4.58 on Ubuntu, docroot
`/var/www/ilikepdf`, `AllowOverride All`, HTTP/1.1.

```sh
npm run build
tar -czf dist.tar.gz -C dist .          # -C dist . so .htaccess is included
scp dist.tar.gz root@HOST:/tmp/
ssh root@HOST 'set -e
  rm -rf /var/www/ilikepdf.new && mkdir -p /var/www/ilikepdf.new
  tar -xzf /tmp/dist.tar.gz -C /var/www/ilikepdf.new
  chown -R root:root /var/www/ilikepdf.new
  find /var/www/ilikepdf.new -type d -exec chmod 755 {} +
  find /var/www/ilikepdf.new -type f -exec chmod 644 {} +
  mv /var/www/ilikepdf /var/www/ilikepdf.bak-$(date +%Y%m%d-%H%M%S)
  mv /var/www/ilikepdf.new /var/www/ilikepdf'
```

A staged swap, so `.html` and `.html.br` are never briefly out of step. Rolling
back is `mv` the other way; old deploys sit in `/var/www/ilikepdf.bak-*` at
~3.7 MB each, clear them out occasionally.

Then point the suites at production — the cheapest end-to-end check there is,
since it exercises brotli, real TLS and pdf.js actually rendering:

```sh
BASE=https://ilikepdf.muriacare.my.id npm test
```

### What a real Apache taught us, that two reviews had not

The `.htaccess` was read twice and looked right both times. The first deploy
served **binary garbage**, at HTTP 200 throughout:

1. **`mod_headers` was not enabled but `mod_rewrite` was** — the default Ubuntu
   install. The rewrite served `pdf.min.js.br` while the block that labels it
   `Content-Encoding: br` was skipped. Guarding the two modules *independently*
   assumed rewriting-without-labelling was survivable. It is the one combination
   that must never happen, so **the rewrite now lives inside the mod_headers
   guard**.
2. **`mod_deflate` re-compressed the pre-compressed response.** Ubuntu's default
   `deflate.conf` gzipped the `.br` payload a second time while
   `Content-Encoding` claimed one layer. The tell was a served `Content-Length`
   of 89,039 for an on-disk `.gz` of 89,006 — *bigger*. Fixed with
   `[E=no-gzip:1,E=no-brotli:1]` on the rewrite itself; `SetEnvIf` can't do it
   because it sees the pre-rewrite URI.

Checks that catch these: `Content-Length` must match the on-disk `.br`
byte-for-byte (when broken it was chunked with no `Content-Length` at all), and
all three encodings must decode to identical bytes.

**Two things to not lose:**

- **`AllowOverride All` is load-bearing.** Ubuntu's `apache2.conf` ships
  `<Directory /var/www/> AllowOverride None`, so the per-vhost block is the only
  reason `.htaccess` is read. Move the docroot without moving that block and the
  site keeps working — just uncompressed, uncached, with nothing to tell you.
- **`mod_brotli` is deliberately not enabled.** Every text file ships a `.br`
  built at quality 11; on-the-fly would be quality 5, cost CPU per request, and
  re-open the double-compression hole.

---

## The record

Kept because in most of these the *first diagnosis was wrong*, and that is what
stops the mistake being made again.

### Phase 9 — three defects (2026-07-29)

**9.1 Export failures were invisible.** `catch` set the message, `finally` called
`update()`, `update()` overwrote it. Both tools now keep a `failure` variable the
render function reads first.

**9.2 Watermark couldn't draw non-Latin text.** — *The write-up claimed
`helvetica.js` "already knows the encodable range". It didn't:* it carried ASCII
32–126 only, so the WinAnsi high range had to be added — `0xA0–0xFF` plus the 27
non-contiguous code points WinAnsi rearranges. Getting that list right is the
whole job; too strict would refuse ordinary European text, which is worse than
the bug. Both directions are asserted.

**9.3 `.htaccess` could 500 the site.** — *The suggested fix would not have
worked.* `<IfModule mod_autoindex.c>` asks whether a module is *loaded*; the 500
came from `AllowOverride` not permitting `Options`, which `<IfModule>` has no
bearing on. The line was removed rather than wrapped. Everything in the
generated `.htaccess` is now one `AllowOverride` class (FileInfo) and guarded for
module presence. `dist/vendor/index.html` is what stops the directory listing.

### Phase 10 — PDFs we didn't make (2026-07-30)

Every fixture we generate is a 595×842 page with one line of Helvetica. The
suites prove the logic and almost nothing about real files. 105 runs, every tool
over 15 third-party PDFs.

**Four of the five predicted problems were not problems.** Embedded CID fonts,
352-page documents (worst tool 21 s), 6–8 MB scans, PDF/A and linearised files
all came through every tool cleanly. That is worth as much as a defect: the
table had been guessing since it was written.

**10.1 AcroForm — confirmed, but the write-up overclaimed.** `copyPages` carries
every widget across, with `/FT`, `/Parent`, `/AP` and `/V` intact. What it drops
is the catalog's **`/AcroForm`**. So the page renders pixel-identically, a
browser still shows fillable boxes, and pdf-lib sees zero fields.
*The shipped warning said "the fields will be gone". Soyae merged hexapdf's
public `acro_form.pdf`, saw them plainly still there, and asked whether he was
doing it wrong. He wasn't.* The wording now claims only what was measured: the
boxes and their contents survive, the form does not. **Merge is affected too —
the prediction named only Split and Organize.**

**10.5 Merge lied about its page count.** An encrypted PDF that six tools refuse
is merged happily, because merge never opens it with pdf.js and pdf-lib is more
tolerant. That capability is worth keeping; the card reading "0 pages" and the
summary promising 3 while the export produced 4 was not. `hydrate()` now
separates "couldn't read it" from "read it, it's empty".

**10.7 Digital signatures — nobody had listed this, and every tool breaks them.**
Two different ways, and the second is worse:

| | Merge · Split · Organize | Rotate · Numbers · Watermark |
|---|---|---|
| signature | **removed entirely** | **kept, and no longer verifies** |
| a viewer says | unsigned | *"this document has been altered"* |

*The first measurement inverted this*, reporting rotate as removing the
signature — pdf-lib saves with object streams, so a byte scan for `/ByteRange`
finds nothing. `tests/signature.mjs` locates the field through pdf-lib instead.

**The rig.** `npm run fetch-real` pulls 15 third-party PDFs into gitignored
`tmp/real/` against a committed manifest with hashes; `npm run probe:real`
sweeps every tool over every one. Neither is in `npm test` — the suites must
pass on a clean offline checkout. *The probe's own first run mis-read every
encrypted file as a hang, because it waited only for success.*

### Phase 11 — deployed and verified (2026-07-30)

See **Deploying** above; that is where the substance lives.
`tests/mobile.smoke.mjs` was added here — 18 assertions, and it exists because
every other suite runs in a desktop context that reports `hover: hover` however
narrow the viewport, leaving three pieces of CSS unreachable, each the *only*
way to do something on a phone (reorder, remove, rotate). It asserts
`hover:none` *first*, or the rest would pass against desktop CSS and prove
nothing.

### Phase 12 — what fell out of the rest

**12.1 A rebuild threw away the user's focus (2026-07-29).** — *The first
diagnosis blamed the keydown handler and was wrong.* That chain is entirely
synchronous. What actually happened: `merge.js` hydrates entries asynchronously
and calls `notifyChange` per entry, and every one is a full `grid.refresh()`
arriving after the keypress had already placed focus. A keyboard user reordering
files lost their place whenever a thumbnail finished loading. Focus now survives
`refresh()` alongside position and thumbnails.

**12.2 Watermark takes a supplied font (2026-07-30).** The complete fix for 9.2:
pick a `.ttf`/`.otf` and any script draws. — *The cost estimate here was wrong.*
`@pdf-lib/fontkit` was recorded as "~140 KB"; it is **758 KB raw / 266 KB
brotli**, the largest single file the site ships, larger than pdf-lib. Only
survivable because nothing fetches it until a font is picked. `subset: true` is
what keeps the *output* cheap — a 5.9 MB face adds ~3 KB.
The two font paths fail in opposite directions: Helvetica *throws* on
non-WinAnsi, a supplied font silently draws **blanks**. Both are checked before
the button enables. `tests/fixtures/tiny.ttf` is 776 bytes, hand-built, and
deliberately lacks a glyph so the missing-glyph path has something to catch.

**12.3 The shared core moved out of every page (2026-07-30).** Worst page 92% →
57%. esbuild emits five chunks rather than one because different page subsets
share different modules; left alone because the graph is **flat**, so they fetch
in one parallel wave. *If a chunk ever imports a chunk that imports a chunk, the
second round trip becomes a third.*
*The bug this shook out only appeared on a tool page:* chunk names resolve
against two bases — an inlined entry sits at the site root and needs
`./js/chunk.x.js`, a chunk is served from `/js/` and needs `./chunk.x.js`. One
map for both asked for `/js/js/` and 404'd, and `index.html` passed anyway
because its chunk imports no other.

**12.4 The landing page, and speculative loading (2026-07-30).** 12.3 cost
`index.html` its content on the first round trip — `<main id="toolGrid">` is
empty in the source, `home.js` draws the cards, so the page committed in 175 ms
on a 150 ms link and then showed **nothing for another 283 ms**. Every suite
passed throughout.

`index.html` is now built **unsplit** (`SOLO` in `build.mjs`) so its entry is
inlined: +283 ms → **+94 ms**, and what remains is body transfer, not a request.
It costs 1,154 B and duplicates the core it also prefetches — deliberate, so the
first thing anyone sees isn't an empty box.

Having made index instant, it pays that forward: it prefetches every chunk the
tool pages ask for, at idle priority. Chunks are `immutable`, so a warmed one is
used with **no revalidation** — which is why this warms chunks and not pages,
since pages are `no-cache` on purpose. Measured: allowing or blocking those
prefetches makes no difference to when index itself renders. Speculation rules
then prerender the hovered card in Chrome/Edge, matched by `selector_matches` so
`js/core/tools.js` stays the only place a tool is declared.

The regression assertion is deterministic rather than timed: block `js/chunk*`
and require the grid anyway. Prerendering itself is *not* asserted — the CDP
`Preload` domain can observe it, but the test would be flaky.

---

## Open work

Nothing is queued. The next work is whatever the next request brings.

- **`dist/` is well ahead of production.** Everything from Phase 10 onward is
  unshipped, including the new `js/` directory. Soyae deploys by hand.
- **Two real-world files would close the two honest gaps**, and both just need
  dropping into `tmp/real/` before a sweep. Neither can be produced on this
  machine — there is no qpdf, Ghostscript or LibreOffice, and pdf-lib can't
  encrypt or sign.
  - **A genuinely signed PDF** (e-materai, or any signed government form) for
    10.7 — the structural fixture proves destruction, not what Acrobat says.
  - **A user-password-protected PDF** whose *page streams* are encrypted, for
    10.5 — to find whether pdf-lib throws or quietly emits garbage.
- **Two minutes on a real phone.** `mobile.smoke.mjs` can't tell you about iOS
  Safari resizing the viewport as the URL bar hides, whether tap targets are
  comfortable under a thumb, or memory limits on a large PDF.
- **`https://muriacare.my.id` has no `:443` vhost**, so it lands on ilikepdf's
  SSL vhost and fails the certificate name check. Pre-existing and unrelated,
  but it is a broken URL. Port 80 is fine.
- **If a page busts the budget again**, the shared CSS is the next lever (3,850 B
  on every page). Do it knowing it is a *worse* trade than the JS split: CSS is
  render-blocking, so extracting it costs a round trip to first paint rather
  than to interactive.

---

## The generalisable bit

Phase 11 showed an `.htaccess` that was reviewed twice, looked right both times,
and was wrong in two ways only a real Apache could reveal. Phase 10 was the same
shape of gap and paid out the same way — but not where anyone was pointing. Of
the six defects it produced, **one was predicted**; one was in a case nobody had
listed, one was a lie in Merge's summary, one was in the probe doing the
measuring, and one was an old Watermark bug that surfaced only because a new
message had to route through the same code.

What a real file teaches you is rarely the thing you opened it to check.
