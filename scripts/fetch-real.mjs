/* Downloads the phase 10 corpus — PDFs we did not make — into tmp/real/.
 *
 *   npm run fetch-real
 *
 * The manifest (tests/real-corpus.json) is committed; the files never are. They
 * are third-party and up to 8 MB each, and NEXT.md's rule for this phase is that
 * large binaries stay out of the repo. sha256 is checked on every run, so a file
 * that changed upstream is a loud failure rather than a quietly different test.
 *
 * Nothing here is part of `npm test`. The suites must keep passing on a clean
 * checkout with no network; this is for `npm run probe:real`.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/real-corpus.json"), "utf8"));
const OUT = path.join(ROOT, manifest.dir);

fs.mkdirSync(OUT, { recursive: true });

const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");
let fetched = 0, kept = 0, failed = 0;

for(const f of manifest.files){
  const dest = path.join(OUT, f.name);
  const url = manifest.sources[f.from] + (f.path || f.name);

  if(fs.existsSync(dest)){
    const have = sha(fs.readFileSync(dest));
    if(have === f.sha256){ kept++; console.log(`  ok       ${f.name}`); continue; }
    console.log(`  stale    ${f.name} — refetching`);
  }

  try{
    const res = await fetch(url);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const got = sha(buf);
    if(got !== f.sha256){
      failed++;
      console.error(`  MISMATCH ${f.name}\n           expected ${f.sha256}\n           got      ${got}`);
      continue;
    }
    fs.writeFileSync(dest, buf);
    fetched++;
    console.log(`  fetched  ${f.name}  ${(buf.length / 1024).toFixed(0)} KB`);
  }catch(e){
    failed++;
    console.error(`  FAILED   ${f.name} — ${e.message}`);
  }
}

const extras = fs.readdirSync(OUT)
  .filter(n => n.endsWith(".pdf") && !manifest.files.some(f => f.name === n));
if(extras.length) console.log(`\n  plus ${extras.length} local file(s) not in the manifest: ${extras.join(", ")}`);

console.log(`\n${fetched} fetched, ${kept} already present, ${failed} failed → ${manifest.dir}/`);
if(failed) process.exitCode = 1;
