/* Builds dist/ — the only thing that gets uploaded.
 *
 *   npm run build
 *
 * The target is one round trip to first paint: every file we serve under 14,336
 * bytes compressed, which is roughly what TCP's initial congestion window lets
 * through before waiting for an acknowledgement. Step 9 fails the build if a
 * page misses it, because a budget nobody enforces is a wish.
 *
 * Each page ships as a single self-contained HTML file, CSS and JS inlined.
 * Shared hosting can't be counted on for HTTP/2, so on a page this small fewer
 * requests beats better caching: the shared code is a few kilobytes, and asking
 * for it separately costs a round trip that dwarfs it.
 *
 * The libraries are the exception and stay separate: they are hundreds of
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

/* ---------- 4–6. one self-contained file per page ---------- */
const pages = fs.readdirSync(ROOT).filter(f => f.endsWith(".html"));
const report = [];

for(const page of pages){
  let html = fs.readFileSync(path.join(ROOT, page), "utf8");

  const entry = /<script type="module" src="([^"]+)"><\/script>/.exec(html);
  if(!entry) throw new Error(`${page} has no module entry point`);

  const built = await esbuild.build({
    entryPoints: [path.join(ROOT, entry[1])],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2020",
    legalComments: "none",
    write: false
  });
  let js = built.outputFiles[0].text;

  // The vendor paths are literal and relative in source precisely so this is a
  // string replace rather than a resolver.
  for(const [from, to] of vendorMap) js = js.split(`"${from}"`).join(`"${to}"`);
  for(const from of vendorMap.keys()){
    if(js.includes(from)) throw new Error(`${page}: unrewritten vendor path ${from}`);
  }

  /* Minify the page with placeholders where the code will go, and only then
     substitute. Minified JS is full of things an HTML parser will try to read
     as markup — `a<0||b>=c` is enough to stop it — and it has already been
     minified anyway, so there is nothing to gain by showing it to this parser. */
  html = html
    .replace(/\s*<link rel="stylesheet" href="css\/[^"]+">/g, "")
    .replace(/<\/head>/, "<style>/*__CSS__*/</style></head>")
    .replace(entry[0], '<script type="module">/*__JS__*/</script>');

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
