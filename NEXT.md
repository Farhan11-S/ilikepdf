# IlikePDF — what to do next

*Written for a Claude session starting cold on this repo. Read this, then
`README.md` for the conventions. `CLAUDE_CODE_HANDOFF.md` is the original spec —
every phase in it is now shipped, so treat it as history, not a task list.*

---

## Where things stand

All eight tools in `js/core/tools.js` are `ready: true` and working. **531
assertions across 10 smoke suites, green against source and the built `dist/`.**
(478 of them were also green against the live site as of Phase 11; the 53 added
in phase 10 have not been run against production — the deploy is behind.)

```sh
npm install && npx playwright install chromium
npm run serve &            # source, port 8000
npm test                   # 531 assertions
npm run build              # -> dist/ + dist.zip, prints the size table
npm run preview &          # dist/, port 8001
BASE=http://localhost:8001 npm test    # same suites against the build
```

Per-suite counts, so you can tell at a glance if something got dropped:
`home 38 · merge 65 · split 86 · rotate 59 · organize 85 · page-numbers 44 ·
watermark 55 · jpg-to-pdf 35 · pdf-to-jpg 46 · mobile 18`.

`npm test` chains with `&&`, so the first suite to fail hides every suite after
it. If something goes red, run the rest individually before concluding it's the
only thing broken.

**The build is honest and enforced.** Order is minify → inline → brotli, so the
`.br` files are compression of already-minified bytes; nothing is double-handled.
Worst page is `watermark.html` at **12,790 B brotli against a 14,336 B budget
(89%)**, and `build.mjs` exits non-zero if any page misses.

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

**All of it is now done.** The original guesses are kept below with what
actually happened, because four of the five were wrong and that is the useful
part:

| kind | predicted | actual |
|---|---|---|
| scanned document (big JPEG per page) | memory during PDF→JPG at 3× | **fine** (10.4) |
| CJK or Cyrillic with embedded fonts | page-numbers/watermark drawing over it | **fine** (10.2) |
| 300+ pages | `IntersectionObserver` queue, `copyPages` cost | **fine**, worst tool 21s (10.3) |
| a fillable form (AcroForm) | copyPages drops form fields | **confirmed**, but not the way predicted (10.1) |
| password-protected | the "name the file" error path | **one real bug**, in Merge (10.5) |
| PDF/A or a linearised file | nothing expected | **nothing** (10.6) |
| *(not predicted at all)* | — | **digital signatures — every tool (10.7)** |

Do **not** commit large binary fixtures. `npm run fetch-real` pulls them into
gitignored `tmp/real/` from a committed manifest; only add a fixture if it's
small and reproducible.

### 10.1 AcroForm — confirmed, but the first write-up overclaimed (2026-07-30)

**The bet paid off, and the mechanism was wrong in a way that matters.** The
prediction was that `copyPages` "doesn't carry form field widgets across". It
carries them across fine — every widget survives on the pages. What it drops is
the catalog's **`/AcroForm` dictionary**, which is the thing that makes them a
*form*. The widgets arrive orphaned.

Measured on a filled-in two-page generated form:

| | source | after copyPages |
|---|---|---|
| pdf-lib `getForm().getFields()` | 5 | **0** |
| pdf.js `getFieldObjects()` | 6 keys | **null** |
| widget annotations on pages | 6 | 6 |
| pdf.js `getAnnotations()` page 1 | 3 Widgets, named | 3 Widgets, named |
| **rendered page 1, differing pixels** | — | **0 of 500,990** |

#### The correction, and how it was caught

**The first version of this section — and the warning that shipped with it —
said "the pages will look right, but the fields will be gone". That is wrong,
and a real file disproved it immediately.** Tested against hexapdf's public
example, <https://hexapdf.gettalong.org/examples/acro_form.pdf>, 14 fields,
19 widgets:

| | source | after merge |
|---|---|---|
| catalog `/AcroForm` | yes (`/Fields` 14, `/DR`, `/DA`) | **absent** |
| widgets on pages | 19 | **19** |
| …with `/FT`, `/Parent`, `/AP`, `/V` | 13 / 6 / 19 / 12 | **13 / 6 / 19 / 12** |
| pdf.js "editable widgets a viewer renders" | 19 | **19** |
| pdf-lib `getFields()` | 14 | **0** |

So the widgets survive *completely*, values included, and **a viewer that builds
its form UI from page annotations still shows fillable boxes** — that is pdf.js
and so Firefox, PDFium and so Chrome. Open the merged file in a browser and it
looks and behaves like a working form. The original wording was therefore a
claim any user could disprove on the first try, which is worse than not warning
at all: it teaches people to ignore the message.

**What is actually lost is the document-level form** — `/Fields`, `/DR`, `/DA`,
the field hierarchy, calculation order. Anything that reads or fills form data
(pdf-lib included, so our own tools) no longer sees a form; FDF/XFDF export and
import, programmatic filling and flattening all break. The current wording
claims exactly that and nothing more:

> "X" has form fields. Being merged keeps the boxes and what's in them, but not
> the form itself — software that reads or fills form data will no longer see one.

`split.smoke.mjs` §12 now asserts **both** directions: that the output has no
form left, *and* that the widgets survive intact, plus a guard that the message
never again says "fields will be gone". The lesson is the one Phase 10 exists
for — the generated fixture and the real file agreed on the mechanism and
disagreed on what it means to a user, and only the real file could say which.

**Three tools, not two.** The prediction named Split and Organize. **Merge has
it too** — same `copyPages` call, same loss. `rotate.js`, `page-numbers.js` and
`watermark.js` all `PDFDocument.load` and mutate in place, never copy, and the
form survives them intact (verified: 5 fields in, 5 fields out through a
rotate). That split — copiers lose forms, mutators don't — is the rule to carry
forward, and it is why `forms.js` is imported by exactly three tools.

**Detected, not implemented**, as called for. `js/core/forms.js` is `hasForm()`
over pdf.js's `getFieldObjects()` plus one shared `formWarning()` wording. Two
things about the shape of it:

- **Detection is free.** All three tools already have a pdf.js document open for
  thumbnails, so nothing is parsed twice. For Merge that meant putting it in
  `thumbs.hydrate()` (the only caller is `merge.js`), which fills in `pages`,
  `thumb` and now `form` from the one open document — reopening every file just
  to ask would have doubled the cost of adding one.
- **Merge needed the 9.1 treatment.** The flag arrives from hydration, one file
  at a time, *after* intake has painted — so the message could not be written
  once at intake and left alone. `merge.js` now has the same `failure` +
  `showNotes()` shape `split.js` and `watermark.js` got in 9.1, and it is the
  same reason: a late thumbnail must not wipe the message.

esbuild keeps `forms.js` off the five pages that don't import it — checked, and
`watermark.html` came out **14 bytes smaller** than before (12,580 of 14,336,
still 88%). The three that do grew: merge 10,861 · split 11,748 · organize
11,136, all comfortably inside budget.

**24 new assertions** (merge +6, split +10, organize +8) at the time; phase 10
finished on **531 across 10 suites**, green against source and `dist/`.
Per-suite: `home 38 · merge 65 · split 86 · rotate 59 · organize 85 ·
page-numbers 44 · watermark 55 · jpg-to-pdf 35 · pdf-to-jpg 46 · mobile 18`.

Each suite asserts **both halves**: that the warning appears and names the file,
*and* that the warning is true — the exported document really does come back
with zero fields. Confirmed failing first by stubbing `hasForm()` to `false`:
the warning assertions failed, the "output has no form left" assertions kept
passing, which is what proves the defect is real and not an artefact of the
detector. Each suite also asserts the negative, that an ordinary PDF is not
accused, and that the warning never disables the export — it is a warning, not a
refusal.

`tests/fixtures/form.pdf` (6.8 KB, 2 pages, 5 fields) is committed, with
`make-form.mjs` beside it. Built with pdf-lib's own form API rather than taken
from a real-world file, so it is small, reproducible, and uses the exact library
version the site ships — what it proves about `copyPages` is about *our*
pdf-lib. Fields are deliberately spread across both pages; a fixture with
everything on page 1 would pass a split that dropped page 2's fields.

**Still not doing form copying.** It means rebuilding the field hierarchy, `/DA`
and `/DR` resources, appearance streams and radio-group kids — squarely in the
class of things this project declines to half-do. The message is the fix.

### 10.2–10.6 — the sweep (2026-07-30)

105 runs, every tool over all 15 files. **Four of the five predicted problems
were not problems at all**, which is worth as much as a defect would have been:
the guesses in the table above were mostly wrong, and now we know rather than
suspect.

| case | verdict |
|---|---|
| **10.2** embedded CID fonts (Arabic, big CMaps) | **clean** — all seven tools; page numbers and watermark draw over them without complaint |
| **10.3** 352 pages (`freeculture.pdf`) | **clean and fast** — merge 1.5s · split 1.7s · organize 1.8s · rotate 2.5s · numbers 2.3s · watermark 21s · PDF→JPG 17s for 352 JPGs (55.7 MB zip). No `IntersectionObserver` trouble, no `copyPages` cost worth naming |
| **10.4** 6–8 MB single-page scans | **clean** — 1.3–2s each, including PDF→JPG at 3× |
| **10.6** PDF/A-1b, and linearised files | **clean** — nothing to report, as predicted |
| **10.5** encrypted / damaged | **one real bug, now fixed** — below |

**`copyPages` throws away unreferenced objects.** `issue3188.pdf` is 7.9 MB and
comes out of merge, split and organize at **0.1 MB** — 224 `/Image` objects
gone. That looked like catastrophic content loss and isn't: the render is
**pixel-identical, 0 of 721,140 pixels different**, because those images were
orphans nothing on the page referenced. The in-place tools keep them (7.7 MB
out) since they never rebuild the document. Do **not** turn this into a
"compress" feature — it is entirely file-dependent (`22060_A1_01_Plans.pdf`,
also a big scan, comes out the same size) and it is deletion of dead objects,
not compression. See the standing refusal at the bottom of this file.

#### 10.5 — Merge accepted a file every other tool refused, and lied about it

`encrypted-attachment.pdf` is refused at intake by Split, Organize, Rotate, Page
numbers, Watermark and PDF→JPG — all six open with pdf.js, which throws. Merge
does not open it with pdf.js at all: `store.addFiles` just reads bytes and
`thumbs.hydrate` swallows the failure. So it merged the file happily, because
**pdf-lib is more tolerant than pdf.js** and read it fine.

Merge being able to do more is not the bug. The bug was that it said nothing
about it and got the arithmetic wrong:

| | before | after |
|---|---|---|
| the card | `0 pages · 3 KB` | `can't preview · 3 KB` |
| the summary | `Pages in result: 3` | `Pages in result: 3+ (1 not previewed)` |
| the panel | *(silent)* | *"…can't be previewed here — pdf-lib is more forgiving than the preview, so it will still be merged."* |
| the actual output | **4 pages** | 4 pages |

A summary that promises 3 and delivers 4 is the same class of dishonesty as
10.1's warning: a number the UI cannot back. `hydrate()` now distinguishes
"couldn't read it at all" from "read it, it has no pages" with an `unreadable`
flag, and the total is rendered as a floor.

Five assertions in `merge.smoke.mjs` §15, against `tests/fixtures/encrypted.pdf`
— 2.7 KB, the same file from mozilla/pdf.js's corpus, small enough to commit and
recorded in `tests/real-corpus.json`. Worth knowing: **pdf.js cannot be patched
to fake this.** `getDocument` is a non-configurable getter, so assigning over it
silently does nothing and the test passes for the wrong reason. That was tried
first.

The other two are working as intended and need no change. `empty_protected.pdf`
opens in every tool and fails at export — late, but the message is right, and
catching it at intake would mean a full pdf-lib parse of every file.
`Brotli-Prototype-FileA.pdf` is not encrypted and still unparseable, which is
the "or damaged" half of that sentence earning its keep.

### 10.7 Digital signatures — every tool breaks them, two different ways

**Not in the original table, and the biggest defect the phase turned up.** A
signature covers a byte range of the file, so anything that re-saves the
document breaks it. pdf-lib re-saves everything. There is no safe tool.

But the *way* it breaks splits along the same line 10.1 found, and the two
outcomes are not equally bad:

| | Merge · Split · Organize | Rotate · Page numbers · Watermark |
|---|---|---|
| how they write | `copyPages` into a new document | load, mutate, save in place |
| the AcroForm (10.1) | dropped | **kept** |
| the signature | **removed entirely** | **kept, and no longer verifies** |
| what a viewer says | an unsigned document | *"this document has been altered"* |

The in-place case is the worse one. A file that has quietly become unsigned is
merely diminished; a file that still claims a signature and fails it looks
**tampered with**, which is a much louder accusation to hand someone
unexpectedly.

A signature is an AcroForm field, so before this the 10.1 detector answered
"yes, has fields" for a signed PDF and told its owner about form data they
hadn't got. `inspectFields()` now separates the two on pdf.js's own field
`type`, and returns `{form, signed}`.

The warning goes on **six** tools, not eight: PDF→JPG and JPG→PDF are left out
because an image cannot carry a signature, so there the loss is the point of the
conversion rather than a surprise. One wording covers both mechanisms —

> "X" is digitally signed. The signature won't survive being merged.

— because the only thing the user has to decide is whether to go ahead, and
which mechanism applies to which tool belongs here rather than in a panel.

**A pre-existing bug fell out of this.** Wiring the message into Watermark
showed that its `update()` rendered `failure || imageError` and clobbered
anything else, and intake sets its note and then calls `update()`. So
Watermark's large-file warning and its "one PDF at a time" note **had never been
visible at all** — 9.1 fixed the failure path there and left the notes outside
the render chain. `note` is now part of what `update()` renders, and
`watermark.smoke.mjs` asserts the message survives a settings change, which is
the thing that used to destroy it.

`tests/fixtures/signed.pdf` (6.5 KB, 2 pages) carries a real AcroForm `/Sig`
field with a correct `/ByteRange`; `/Contents` holds a SHA-256 of the bytes that
range covers instead of a CMS blob, so `tests/signature.mjs` can verify it with
no certificate and no new dependency. `verifySignature()` locates the field
**through pdf-lib rather than by scanning for `/ByteRange`** — that matters:
pdf-lib saves with object streams by default, so after an in-place tool the
signature is still there but compressed, and a byte scan reports it missing.
Getting that wrong inverts the finding, and it did on the first attempt.

**Honest limit:** this proves detection and destruction. It cannot tell you what
Acrobat says about a real CMS signature — that still wants one genuinely signed
real-world file, ideally an e-materai or signed government form, which is also
more representative of what this site's users actually upload. Dropping one into
`tmp/real/` is all it takes.

### The rig

Phase 10 is repeatable now rather than a session's worth of ad hoc runs:

```sh
npm run fetch-real     # tests/real-corpus.json -> tmp/real/, sha256 checked
npm run probe:real     # every tool over every file; writes tmp/real-report.md
```

`tests/real-corpus.json` is committed and lists 15 files with their hashes and
what each is for; the binaries stay out of the repo per this phase's own rule,
and `tmp/` was already gitignored. Anything dropped into `tmp/real/` by hand is
swept too, manifest or not.

`tests/real.probe.mjs` is **not** in `npm test` — it needs files a clean
checkout doesn't have. It runs every tool over every file rather than only the
predicted pairs, which is the lesson of 10.1 turned into a habit.

One thing it got wrong on its first run, worth keeping in mind for anything
similar: it waited only for `#done.on`, so a tool that *correctly* reported a
failed export looked like a 120-second hang. It now waits for the progress bar
to stop and either outcome to appear.

---

## Phase 11 — Deployed and verified (2026-07-30)

Live at **https://ilikepdf.muriacare.my.id** — Apache 2.4.58 on Ubuntu, docroot
`/var/www/ilikepdf`, `AllowOverride All`. The `.htaccess` is no longer untested by
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
- **All 478 assertions pass against the live site.** The suites take any
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
  rm -rf /var/www/ilikepdf.new && mkdir -p /var/www/ilikepdf.new
  tar -xzf /tmp/dist.tar.gz -C /var/www/ilikepdf.new
  chown -R root:root /var/www/ilikepdf.new
  find /var/www/ilikepdf.new -type d -exec chmod 755 {} +
  find /var/www/ilikepdf.new -type f -exec chmod 644 {} +
  mv /var/www/ilikepdf /var/www/ilikepdf.bak-$(date +%Y%m%d-%H%M%S)
  mv /var/www/ilikepdf.new /var/www/ilikepdf'
```

Rolling back is `mv` in the other direction; the previous deploy is kept as
`/var/www/ilikepdf.bak-*`. Clear old ones out occasionally, each is ~3.7 MB.

**`AllowOverride All` is load-bearing and easy to lose.** Ubuntu's
`apache2.conf` ships `<Directory /var/www/> AllowOverride None`, so the
per-vhost `<Directory /var/www/ilikepdf>` block is the only reason `.htaccess`
is read at all. Move the docroot without moving that block and the site keeps
working — just uncompressed, with no cache headers, and nothing to tell you.

Moved off `/root/ilikepdf` on 2026-07-30: serving out of root's home only
worked because `/root` is `drwx--x`, one `chmod` away from publishing the whole
home directory. Both vhosts (`:80` and `:443`) were updated together — the
`DocumentRoot` *and* the `<Directory>` block.

### The touch path now has a suite

`tests/mobile.smoke.mjs`, 18 assertions. It exists because every other suite
runs in a desktop context, which reports `hover: hover` however narrow you make
the viewport — so three pieces of CSS were unreachable from the whole suite, and
each is the *only* way to do something on a phone:

| rule | without it, on touch |
|---|---|
| `.tile .move` | no reordering at all — drag doesn't exist |
| `.tile .remove` | no way to remove a file |
| `.tile-controls` | no way to rotate a page |

`launch()` now passes extra options through to the browser context;
`isMobile`/`hasTouch` is what flips Chromium to hover:none and pointer:coarse.
The suite asserts that *first* — without that check the rest would quietly pass
against desktop CSS and prove nothing.

It also covers the bottom-sheet panel under 900px, and completes a merge and a
rotate entirely by tap. Green against source, `dist/` and production.

**What it still cannot tell you** is what only real hardware can: iOS Safari
resizing the viewport as the URL bar hides, whether the tap targets are
comfortable under a thumb, and memory limits on a large PDF. Worth two minutes
on an actual phone, but it is no longer an untested path.

### Still worth doing

- **`https://muriacare.my.id` has no `:443` vhost**, so it lands on ilikepdf's
  SSL vhost and fails the certificate name check. Pre-existing, unrelated to
  this site, but it is a broken URL. Port 80 is fine.
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
10.1 AcroForm               DONE      2026-07-30  (confirmed; 3 tools, not 2)
10.2-10.6 the sweep         DONE      2026-07-30  (4 of 5 were non-problems)
10.7 digital signatures     DONE      2026-07-30  (not predicted; all 6 tools)
12.2 font embedding         open      only if someone asks
```

**Phase 10 is done.** What is left is 12.2, which is explicitly "only if someone
asks", so the next real work is whatever the next request brings.

Two things a future session should pick up:

- **`dist/` is well ahead of production.** Phase 10 changed all six PDF→PDF
  pages. Deploy with the staged swap in Phase 11.
- **One genuinely signed real-world PDF** would close the last honest gap in
  10.7 — an e-materai or a signed government form, dropped into `tmp/real/`.
  The structural fixture proves destruction; it cannot prove what Acrobat says.

The lesson from 11 was that the `.htaccess` was reviewed twice, looked right
both times, and was still wrong in two ways only a real Apache could show. Phase
10 was the same shape of gap and it paid out the same way — but not where
anyone was pointing. **Of the six defects the phase produced, one was predicted
(10.1, and the prediction was wrong about what it meant), one was in a case
nobody had listed at all (10.7, signatures), one was a lie in Merge's summary
(10.5), one was a bug in the probe measuring all this, and one was a
nine-month-old bug in Watermark that only surfaced because a new message had to
be routed through the same code.** Four of the five things the table predicted
would break didn't.

The generalisable bit: what a real file teaches you is rarely the thing you
opened it to check.

One thing worth knowing before you start a server: something else may already
hold port 8000 (a `php -S localhost:8000` was running during Phase 12). `npm run
serve` fails with "address in use" and the suites then quietly test *whatever is
on that port* instead. If results stop making sense, check what you are actually
talking to before you debug the code:

```sh
curl -s http://localhost:8000/js/core/grid.js | head -1    # should be JS, not HTML
```
