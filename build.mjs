/* Builds dist/ — the only thing that gets uploaded.
 *
 *   npm run build
 *
 * The target is one round trip to first paint: every file we serve under 14,336
 * bytes compressed, which is roughly what TCP's initial congestion window lets
 * through before waiting for an acknowledgement. Step 9 fails the build if a
 * page misses it, because a budget nobody enforces is a wish.
 *
 * Note what that budget is and isn't. The congestion window belongs to the
 * *connection*, not to each file, so splitting one 13 KB response into two 7 KB
 * ones does not buy a second window — both still draw on the first, and the
 * second cannot even be requested until the first has arrived. "Every file
 * under 14 KB" is a weaker property than "the page arrives in one round trip",
 * and only the first is still true here.
 *
 * A page ships as HTML with its CSS and its own JS inlined, plus content-hashed
 * shared chunks alongside. Pages were wholly self-contained until watermark.html
 * reached 92% of budget; bundling all nine entries together lets esbuild lift
 * what more than one page uses into chunks that are cached for a year, so the
 * shared core is paid for once across the site rather than once per page.
 *
 * The trade, stated plainly: first paint is unchanged, because the CSS is
 * inline and a module script is deferred regardless. Time to *interactive* is
 * one round trip later on a first visit, and free on every later page.
 *
 * The libraries are separate for a different reason: they are hundreds of
 * kilobytes, they change only when the pin changes, and they are shared across
 * every page. They get content-hashed names and a year-long immutable cache.
 *
 * Source is left alone and stays directly servable, so `npm run serve` and
 * `npm test` keep working with no build step in the way.
 */
import esbuild from "esbuild";
import { bundle as bundleCss } from "lightningcss";
import { minify as minifyHtml } from "html-minifier-terser";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");
const BUDGET = 14 * 1024;          // 14,336 bytes, brotli

const brotli = buf => zlib.brotliCompressSync(buf, {
  params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
});
const gzip = buf => zlib.gzipSync(buf, { level: 9 });
let CRC_TABLE = null;   // declared up here: zipDist() runs before the tail of this file

/* ---------- 1. clean ---------- */
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "vendor"), { recursive: true });

/* ---------- 2. vendor, content-hashed ---------- */
const vendorMap = new Map();       // "vendor/pdf.min.js" -> "vendor/pdf.a1b2c3d4.min.js"
for(const name of fs.readdirSync(path.join(ROOT, "vendor"))){
  const bytes = fs.readFileSync(path.join(ROOT, "vendor", name));
  const hash = createHash(bytes);
  // pdf.min.js -> pdf.<hash>.min.js
  const hashed = name.replace(/\.min\.js$/, `.${hash}.min.js`);
  fs.writeFileSync(path.join(DIST, "vendor", hashed), bytes);
  vendorMap.set(`vendor/${name}`, `vendor/${hashed}`);
}
/* The only directory without an index of its own, and the reason .htaccess no
   longer says `Options -Indexes` — see htaccess() for why that line was a
   liability. A page here is what stops the server listing the vendored files. */
fs.writeFileSync(path.join(DIST, "vendor", "index.html"),
  '<!doctype html><title>ilikepdf</title><a href="../">← ilikepdf</a>\n');
fs.copyFileSync(path.join(ROOT, "favicon.svg"), path.join(DIST, "favicon.svg"));

/* ---------- 3. CSS ---------- */
/* One stylesheet from the two sources, in the order the pages link them —
   app.css depends on the tokens. */
const cssEntry = path.join(ROOT, "css", "_bundle.css");
fs.writeFileSync(cssEntry, '@import "tokens.css";\n@import "app.css";\n');
let css;
try{
  css = bundleCss({ filename: cssEntry, minify: true }).code.toString();
}finally{
  fs.rmSync(cssEntry, { force: true });
}

/* ---------- 4. bundle every page in one pass, so the shared core splits out ----

   Pages used to be bundled one at a time and inlined whole, which meant all
   nine carried their own copy of grid.js, store.js, panel.js and the rest. That
   was the right trade while the worst page had room: one request beats better
   caching when the duplicate is a few kilobytes.

   It stopped being the right trade at 92% of budget. Building all the entries
   together lets esbuild pull what more than one page uses into shared chunks,
   which are content-hashed and cached for a year, so the duplication is paid
   for once across the whole site instead of once per page.

   What it costs is honest and worth knowing: the page still paints in one round
   trip — the CSS is inline and a module script is deferred anyway — but it is
   interactive one round trip later on a first visit, because the chunks cannot
   be asked for until the HTML naming them has arrived. The chunk graph is flat
   (every chunk is imported by the entry, never chunk-to-chunk-to-chunk), so
   they are all requested in one parallel wave rather than a waterfall. That
   flatness is a property worth keeping; if a chunk ever imports a chunk that
   imports a chunk, the second round trip becomes a third. */
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html"));
const report = [];

/* index.html is built on its own, unsplit, so it carries its whole entry inline
   and paints its grid the moment the HTML parses.

   It is the one page where the split was a straight loss. `<main id="toolGrid">`
   is empty in the source — home.js draws the cards — so once the core moved into
   a chunk, the landing page committed in 175 ms on a 150 ms link and then showed
   nothing for another 283 ms. Every other page has a hero and a working file
   picker to look at while its chunks arrive; this one has an empty box.

   The cost is that index duplicates the core it also prefetches below. That is
   the trade being made on purpose: about a kilobyte on one page, to stop the
   first thing anyone sees being blank. */
const SOLO = new Set(["index.html"]);

const entryOf = new Map();          // page -> {src, abs, tag}
for(const page of pages){
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const m = /<script type="module" src="([^"]+)"><\/script>/.exec(html);
  if(!m) throw new Error(`${page} has no module entry point`);
  entryOf.set(page, { src: m[1], abs: path.join(ROOT, m[1]), tag: m[0] });
}

const shared = pages.filter(p => !SOLO.has(p));
const bundled = await esbuild.build({
  entryPoints: shared.map(p => entryOf.get(p).abs),
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  legalComments: "none",
  splitting: true,
  outdir: path.join(DIST, "js"),
  write: false,
  metafile: true
});

/* The solo pages, each bundled whole. */
const soloJs = new Map();           // page -> bundled text
for(const page of SOLO){
  const built = await esbuild.build({
    entryPoints: [entryOf.get(page).abs],
    bundle: true, minify: true, format: "esm", target: "es2020",
    legalComments: "none", write: false
  });
  soloJs.set(page, built.outputFiles[0].text);
}

/* The vendor paths are literal and relative in source precisely so this is a
   string replace rather than a resolver. */
const rewriteVendor = (js, where) => {
  for(const [from, to] of vendorMap) js = js.split(`"${from}"`).join(`"${to}"`);
  for(const from of vendorMap.keys()){
    if(js.includes(from)) throw new Error(`${where}: unrewritten vendor path ${from}`);
  }
  return js;
};

const outputs = new Map(bundled.outputFiles.map(f => [f.path, f.text]));
const isEntry = new Map();          // output path -> entry source path, for entries only
for(const [out, info] of Object.entries(bundled.metafile.outputs)){
  if(info.entryPoint) isEntry.set(path.resolve(ROOT, out), path.resolve(ROOT, info.entryPoint));
}

/* Hash the chunks, deepest first. A chunk that imports another has to be named
   after the one it names, or its own hash would be computed over a stale path.

   The map holds bare filenames because the two kinds of importer resolve them
   against different bases: an entry is inlined into a page at the site root and
   needs "./js/chunk.x.js", while a chunk is served from /js/ and needs
   "./chunk.x.js". Getting that wrong asks for /js/js/ and 404s — which is
   exactly what the first attempt did, and only a tool page showed it, because
   the home page's chunk imports no other chunk. */
fs.mkdirSync(path.join(DIST, "js"), { recursive: true });
const chunkName = new Map();        // "./chunk-ABC.js" (as esbuild wrote it) -> "chunk.<hash>.min.js"
const inChunk = js => { for(const [from, to] of chunkName) js = js.split(`"${from}"`).join(`"./${to}"`); return js; };
const inEntry = js => { for(const [from, to] of chunkName) js = js.split(`"${from}"`).join(`"./js/${to}"`); return js; };
const chunkPaths = [...outputs.keys()].filter(p => !isEntry.has(p));
const pending = new Set(chunkPaths);

while(pending.size){
  const ready = [...pending].filter(p => {
    const info = bundled.metafile.outputs[path.relative(ROOT, p).split(path.sep).join("/")];
    return info.imports.filter(i => i.kind === "import-statement")
      .every(i => !pending.has(path.resolve(ROOT, i.path)));
  });
  if(!ready.length) throw new Error("chunk imports form a cycle");

  for(const p of ready){
    const text = inChunk(rewriteVendor(outputs.get(p), path.basename(p)));
    const bytes = Buffer.from(text);
    const hashed = `chunk.${createHash(bytes)}.min.js`;
    write(path.join(DIST, "js", hashed), bytes);
    chunkName.set(`./${path.basename(p)}`, hashed);
    outputs.set(p, text);
    pending.delete(p);
  }
}

/* The same reason vendor/ has one: a directory with no index is a listing. */
fs.writeFileSync(path.join(DIST, "js", "index.html"),
  '<!doctype html><title>ilikepdf</title><a href="../">← ilikepdf</a>\n');

/* Everything a tool page will ask for, so the landing page can fetch it while
   the visitor is still deciding which tool they want.

   `prefetch` rather than `modulepreload` on purpose: this is for the *next*
   navigation, so it belongs at idle priority behind anything this page needs.
   It pays off because the chunks are content-hashed and served `immutable` —
   a warmed chunk is used outright, with no revalidation round trip. Pages are
   `no-cache` and would not behave that way, which is why this warms the chunks
   and leaves the documents to the speculation rules below. */
const warm = [...new Set(shared.flatMap(p => {
  const out = [...isEntry.entries()].find(([, src]) => src === entryOf.get(p).abs)?.[0];
  const rel = path.relative(ROOT, out).split(path.sep).join("/");
  return bundled.metafile.outputs[rel].imports
    .filter(i => i.kind === "import-statement")
    .map(i => chunkName.get(`./${path.basename(i.path)}`));
}))].filter(Boolean).sort();

const preload = warm.map(n => `<link rel="prefetch" as="script" href="js/${n}">`).join("");

/* Chrome and Edge prerender the card under the cursor; everything else ignores
   an unknown script type and falls back to the prefetched chunks above.

   `selector_matches` rather than a list of URLs so js/core/tools.js stays the
   only place a tool is declared — and because the cards are drawn by JS, which
   document rules cope with by re-evaluating as the DOM changes.

   Prerendering runs the target page. That is safe here and worth re-checking if
   it ever stops being: a tool page on load only mounts its grid, panel and
   dropzone, and nothing reads a file until the user picks one. */
const speculation = '<script type="speculationrules">' +
  JSON.stringify({ prerender: [{ where: { selector_matches: ".tool-card" }, eagerness: "moderate" }] }) +
  "</script>";

/* ---------- 5–6. one page per file, entry inlined, chunks alongside ---------- */
for(const page of pages){
  let html = fs.readFileSync(path.join(ROOT, page), "utf8");
  const entry = entryOf.get(page);

  let js;
  if(SOLO.has(page)){
    js = rewriteVendor(soloJs.get(page), page);
  }else{
    const outPath = [...isEntry.entries()].find(([, src]) => src === entry.abs)?.[0];
    if(!outPath) throw new Error(`${page}: no bundle produced for ${entry.src}`);
    js = inEntry(rewriteVendor(outputs.get(outPath), page));
  }
  if(/["']\.\/chunk-/.test(js)) throw new Error(`${page}: unrewritten chunk import`);

  /* Minify the page with placeholders where the code will go, and only then
     substitute. Minified JS is full of things an HTML parser will try to read
     as markup — `a<0||b>=c` is enough to stop it — and it has already been
     minified anyway, so there is nothing to gain by showing it to this parser. */
  html = html
    .replace(/\s*<link rel="stylesheet" href="css\/[^"]+">/g, "")
    .replace(/<\/head>/, (SOLO.has(page) ? preload : "") + "<style>/*__CSS__*/</style></head>")
    .replace(entry.tag, '<script type="module">/*__JS__*/</script>' +
                        (SOLO.has(page) ? speculation : ""));

  html = await minifyHtml(html, {
    collapseWhitespace: true,
    conservativeCollapse: false,
    removeComments: true,
    removeRedundantAttributes: true,
    minifyCSS: false,      // lightningcss already did it
    minifyJS: false        // esbuild already did it
  });

  // split/join, not replace: a lone "$&" in the code would otherwise expand.
  html = html
    .split("/*__CSS__*/").join(css)
    // A literal "</script>" in the code would close the tag it sits in.
    .split("/*__JS__*/").join(js.replace(/<\/script/gi, "<\\/script"));

  write(path.join(DIST, page), Buffer.from(html));
}

/* ---------- 7. pre-compress everything else ---------- */
for(const name of fs.readdirSync(path.join(DIST, "vendor"))){
  const p = path.join(DIST, "vendor", name);
  compress(p, fs.readFileSync(p));
}
compress(path.join(DIST, "favicon.svg"), fs.readFileSync(path.join(DIST, "favicon.svg")));
// The chunks were compressed by write(); their index page was not.
compress(path.join(DIST, "js", "index.html"),
  fs.readFileSync(path.join(DIST, "js", "index.html")));

/* ---------- 8. .htaccess ---------- */
fs.writeFileSync(path.join(DIST, ".htaccess"), htaccess());

/* ---------- 9. the budget ---------- */
report.sort((a, b) => b.br - a.br);
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
console.log("\n  " + pad("file", 22) + num("raw", 9) + num("gzip", 9) + num("brotli", 9));
console.log("  " + "─".repeat(49));
for(const r of report){
  const over = r.html && r.br > BUDGET;
  console.log("  " + pad(r.name, 22) + num(r.raw, 9) + num(r.gz, 9) + num(r.br, 9) +
              (over ? "   OVER" : ""));
}
const worst = report.filter(r => r.html).reduce((a, b) => a.br > b.br ? a : b);
console.log(`\n  budget ${BUDGET} B brotli · worst page ${worst.name} at ${worst.br} B ` +
            `(${Math.round(worst.br / BUDGET * 100)}%)\n`);

const over = report.filter(r => r.html && r.br > BUDGET);
if(over.length){
  console.error("  over budget: " + over.map(r => `${r.name} ${r.br} B`).join(", "));
  console.error("  cheapest lever: pull the shared CSS out to one cached file.\n");
  process.exit(1);
}

/* ---------- 10. dist.zip, for hosts with only a file manager ---------- */
/* cPanel's uploader takes one archive and unpacks it; dragging ~30 files in
   one at a time is how a deploy ends up half-finished. */
zipDist();

function zipDist(){
  const files = [];
  walk(DIST, "");
  const parts = [];
  const central = [];
  let offset = 0;

  for(const { rel, buf } of files){
    const name = Buffer.from(rel, "utf8");
    const crc = crc32(buf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 8);            // stored, no compression
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(buf.length, 18);
    local.writeUInt32LE(buf.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, buf);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(buf.length, 20);
    dir.writeUInt32LE(buf.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + buf.length;
  }

  const body = Buffer.concat(parts);
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(body.length, 16);

  const zip = path.join(ROOT, "dist.zip");
  fs.writeFileSync(zip, Buffer.concat([body, dirBuf, end]));
  console.log(`  dist.zip ${Math.round(fs.statSync(zip).size / 1024)} KB ` +
              `(${files.length} files, stored — the contents are already compressed)\n`);

  function walk(dir, prefix){
    for(const name of fs.readdirSync(dir)){
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if(fs.statSync(full).isDirectory()) walk(full, rel);
      else files.push({ rel, buf: fs.readFileSync(full) });
    }
  }
}

function crc32(buf){
  if(!CRC_TABLE){
    CRC_TABLE = new Int32Array(256);
    for(let n = 0; n < 256; n++){
      let c = n;
      for(let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for(let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------- helpers ---------- */

function createHash(bytes){
  // Not cryptography — just a stable name that changes when the bytes do.
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for(let i = 0; i < bytes.length; i++){
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 + bytes[i], 0x85ebca6b) ^ (h2 >>> 13);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 8);
}

function write(file, buf){
  fs.writeFileSync(file, buf);
  const { br, gz } = compress(file, buf);
  report.push({ name: path.basename(file), raw: buf.length, br, gz, html: file.endsWith(".html") });
}

/* Shared hosting often has no mod_brotli, but Apache will happily serve a file
   we compressed ourselves if we set Content-Encoding — which is what makes the
   budget a real number rather than an aspiration. */
function compress(file, buf){
  const br = brotli(buf), gz = gzip(buf);
  fs.writeFileSync(file + ".br", br);
  fs.writeFileSync(file + ".gz", gz);
  return { br: br.length, gz: gz.length };
}

function htaccess(){
  return `# Generated by build.mjs — edit that, not this.
#
# Serving pre-compressed files takes two modules, and they fail differently:
#
#   mod_rewrite picks the .br/.gz copy. Missing, you serve the plain file —
#     bigger, but correct.
#   mod_headers labels it Content-Encoding. Missing, the browser is handed
#     brotli bytes labelled text/html. That is not a degraded page, it is a
#     broken one, and nothing in the response says so.
#
# Which is why the rewrite lives *inside* the mod_headers guard. Rewriting
# without labelling is the one combination that must never happen, and a host
# with mod_rewrite but not mod_headers is not hypothetical — it is the default
# Ubuntu Apache install.
#
# <IfModule> only asks whether a module is loaded, never whether AllowOverride
# permits the directive, so everything here is also deliberately one
# AllowOverride class: RewriteRule, Header and AddType all need FileInfo.
#
# There is no \`Options -Indexes\`: it needs AllowOverride Options, which shared
# hosts commonly withhold, and an <IfModule> would not have saved it —
# vendor/index.html stops the listing instead. \`DirectoryIndex index.html\` is
# gone for the same reason, and mod_dir defaults to index.html regardless.

<IfModule mod_headers.c>
<IfModule mod_rewrite.c>
  RewriteEngine On

  # Serve the pre-compressed copy when the browser says it can take it.
  #
  # no-gzip and no-brotli are load-bearing. Without them mod_deflate/mod_brotli
  # compress the already-compressed bytes a second time, while Content-Encoding
  # below still claims a single layer — so the browser unwraps once and finds
  # compressed data. Browsers send "gzip, deflate, br", so this is the ordinary
  # request, not an edge case: leaving these off breaks the site for everyone.
  RewriteCond %{HTTP:Accept-Encoding} br
  RewriteCond %{REQUEST_FILENAME}.br -f
  RewriteRule ^(.*)$ $1.br [QSA,L,E=no-gzip:1,E=no-brotli:1]

  RewriteCond %{HTTP:Accept-Encoding} gzip
  RewriteCond %{REQUEST_FILENAME}.gz -f
  RewriteRule ^(.*)$ $1.gz [QSA,L,E=no-gzip:1,E=no-brotli:1]

  # The rewrite changed the extension, so the real type has to be put back.
  # These match the re-injected request, so they re-assert the env vars too.
  RewriteRule \\.html\\.(br|gz)$ - [T=text/html,E=no-gzip:1,E=no-brotli:1]
  RewriteRule \\.js\\.(br|gz)$   - [T=application/javascript,E=no-gzip:1,E=no-brotli:1]
  RewriteRule \\.svg\\.(br|gz)$  - [T=image/svg+xml,E=no-gzip:1,E=no-brotli:1]
</IfModule>

  <FilesMatch "\\.br$">
    Header set Content-Encoding br
  </FilesMatch>
  <FilesMatch "\\.gz$">
    Header set Content-Encoding gzip
  </FilesMatch>
  # Caches must not hand a brotli copy to a client that can't read it.
  <FilesMatch "\\.(html|js|svg)(\\.(br|gz))?$">
    Header append Vary Accept-Encoding
  </FilesMatch>

  # Vendor filenames carry a content hash, so they can be cached forever.
  <FilesMatch "\\.[a-z0-9]{8}\\.min\\.js(\\.(br|gz))?$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  # Pages are not hashed, so a redeploy has to be picked up straight away.
  <FilesMatch "\\.html(\\.(br|gz))?$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>

<IfModule mod_mime.c>
  AddType application/javascript .js
  AddType image/svg+xml .svg
</IfModule>
`;
}
