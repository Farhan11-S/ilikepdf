# IlikePDF — what to do next

*Written for a Claude session starting cold on this repo. Read this, then
`README.md` for the conventions. `CLAUDE_CODE_HANDOFF.md` is the original spec —
every phase in it is now shipped, so treat it as history, not a task list.*

---

## Where things stand

All eight tools in `js/core/tools.js` are `ready: true` and working. **448
assertions across 9 smoke suites, green against both source and the built
`dist/`.**

```sh
npm install && npx playwright install chromium
npm run serve &            # source, port 8000
npm test                   # 448 assertions
npm run build              # -> dist/ + dist.zip, prints the size table
npm run preview &          # dist/, port 8001
BASE=http://localhost:8001 npm test    # same suites against the build
```

Per-suite counts, so you can tell at a glance if something got dropped:
`home 38 · merge 49 · split 68 · rotate 53 · organize 74 · page-numbers 41 ·
watermark 44 · jpg-to-pdf 35 · pdf-to-jpg 46`.

**The build is honest and enforced.** Order is minify → inline → brotli, so the
`.br` files are compression of already-minified bytes; nothing is double-handled.
Worst page is `watermark.html` at **12,259 B brotli against a 14,336 B budget
(86%)**, and `build.mjs` exits non-zero if any page misses.

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

## Phase 9 — Three defects, all verified (do this first)

Small, safe, and two of them affect anyone who uses the site.

### 9.1 Export failures are invisible in Watermark and Split

**Severity: high.** The user presses the action button, the export throws, and
**nothing appears** — no error, no done screen, no explanation. Both reproduced
in a browser, not inferred.

**Cause.** The `catch` sets the message, then `finally` calls `update()`, and
`update()` calls `panel.setError(...)` unconditionally, overwriting it:

| file | `catch` sets it | `update()` wipes it |
|---|---|---|
| `js/tools/watermark.js` | line 325 | line 247 — `panel.setError(imageError)` |
| `js/tools/split.js` | line 270 | line 198 — `panel.setError(error || note)` |

The other seven tools are fine: their `update()` doesn't touch the error line.
Don't "fix" them.

**Reproduce.**

```
Watermark: load any PDF, set the text to 日本語, press Add watermark.
           Nothing happens. Console shows the real error.
Split:     load a PDF, run one export so pdf-lib is cached, then in devtools
           window.PDFLib.PDFDocument.load = () => { throw new Error("x") }
           and press Split. Nothing happens.
```

**Fix.** Don't special-case the error line — make the failure part of what
`update()` renders, the way `split.js` already treats its `note`. Add a module
variable, clear it when the action starts, set it in `catch`, and have `update()`
render it first:

```js
let failure = "";                      // survives until the next attempt

panel.onAction(async () => {
  failure = "";
  …
  }catch(err){
    failure = "That PDF couldn't be watermarked. It may be password-protected or damaged.";
    console.error(err);
  }finally{ … update(); }
});

function update(){
  …
  panel.setError(failure || imageError);     // split: failure || error || note
}
```

**Acceptance.** Add an assertion to `tests/watermark.smoke.mjs` and
`tests/split.smoke.mjs` that forces a failure (patch `window.PDFLib` as above)
and checks `.panel .error` is **visible and non-empty** afterwards. That
assertion must fail against the current code — verify it does before fixing.

### 9.2 Watermark can't draw non-Latin text

**Severity: medium.** `StandardFonts.Helvetica` is WinAnsi-encoded, so
`drawText` throws on anything outside it. Measured:

| watermark text | result |
|---|---|
| `Café — naïve` | works (WinAnsi covers it) |
| `日本語テキスト` | throws |
| `CONFIDENTIAL ✓` | throws |

Once 9.1 lands this at least *says* something — but it will say "the PDF may be
password-protected or damaged", which is wrong and sends people hunting for a
password that was never set.

**Fix.** Detect it before export, not after. `js/core/helvetica.js` already
knows the encodable range (ASCII 32–126 plus the WinAnsi high range); export a
predicate from there and use it in `update()` to disable the action button with
an honest label, the same way every other tool explains a disabled button:

```js
panel.setEnabled(false, "Helvetica can't draw those characters");
```

Note this affects **Watermark only**. Page numbers builds its text from digits
and the words "Page"/"of", so it is always encodable — don't add the check
there.

**Scope decision to make first:** the alternative is letting users upload a
`.ttf` and calling `registerFontkit` + `embedFont`. That is a real feature, adds
a dependency (`@pdf-lib/fontkit`, ~140 KB), and pushes `watermark.html` toward
the byte budget. **Recommend the honest message now**, font upload only if
someone actually asks. Do not do both.

### 9.3 `.htaccess` can 500 the whole site

**Severity: high if it happens, and it's one line.** `build.mjs:310` emits
`Options -Indexes` **outside** any `<IfModule>` guard. On shared hosting where
`AllowOverride` doesn't include `Options`, Apache returns **500 on every
request**. Every other directive in that file is guarded; this one was missed.

**Fix.** Wrap it, or drop it — directory listing is already moot because every
directory has an `index.html`… except `vendor/`, which doesn't.

```apache
<IfModule mod_autoindex.c>
  Options -Indexes
</IfModule>
```

**Acceptance.** `npm run build` then grep `dist/.htaccess` to confirm no bare
`Options` line survives outside a guard.

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

## Phase 11 — Deploy, then verify the parts that can't be tested locally

`dist/` has never been served by Apache. There is no Apache in the dev
container, so the whole `.htaccess` is **untested by construction** — the suites
run against `python3 -m http.server`, which ignores it entirely.

1. Upload `dist/` (or `dist.zip`, which cPanel's file manager unpacks).
2. **Confirm compression is actually happening**, because the entire byte budget
   rests on it:
   ```sh
   curl -sI -H 'Accept-Encoding: br' https://YOURSITE/watermark.html | grep -i 'content-encoding\|vary'
   ```
   Expect `content-encoding: br` and `vary: Accept-Encoding`. If it's missing,
   the rewrite isn't firing and you're serving 42 KB instead of 12 KB — the site
   still works, so nothing will alert you.
3. **Confirm nothing is double-encoded.** If a browser shows binary garbage, the
   `.br` is being served without `Content-Encoding` — that's the failure mode to
   watch for, and it breaks the page completely.
4. Check caching: a hashed `vendor/*.min.js` should return
   `cache-control: public, max-age=31536000, immutable`; `.html` should return
   `no-cache`.
5. Load a tool on a real phone. The panel becomes a fixed bottom sheet under
   900px and the touch reorder buttons only exist under `hover:none` — both are
   only ever exercised by an emulated viewport in CI.

If the host turns out to have no `mod_rewrite` or no `mod_headers`, the
`<IfModule>` guards mean it degrades to serving the uncompressed files. That's
fine and expected — you lose the budget, not the site.

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
- **Vendor paths in source must stay literal and relative** (`"vendor/pdf.min.js"`,
  never built from a variable). The build rewrites them to hashed names with a
  string replace and *throws* if any survive — which is what keeps `dist/`
  working from a subdirectory.
- **Run the whole suite, not just the one you touched.** The core modules are
  shared; a change for one tool has broken another in phases 1, 2, 4 and 5.

---

## Suggested order

```
9.3  .htaccess guard        ~5 min    blocks deploy, one line
9.1  silent failures        ~30 min   two files, two new assertions
9.2  non-Latin watermark    ~30 min   decide message-vs-font first
11   deploy + verify        ~1 hr     the parts CI structurally cannot cover
10   real-world PDFs        open      the actual unknown
```

9.3 first because it's five minutes and it's the one that can take the site down
entirely. 10 is last because it's open-ended discovery, not a task with a
finish line — expect it to generate its own phase 12.
