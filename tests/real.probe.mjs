/* Phase 10 sweep — every tool over every PDF in tmp/real/.
 *
 *   npm run serve &
 *   npm run fetch-real
 *   npm run probe:real
 *
 * Deliberately NOT part of `npm test`: it needs files that are not in the repo,
 * so a clean checkout must not depend on it. This is a diagnostic that prints a
 * matrix and writes tmp/real-report.md; findings get written up in NEXT.md and,
 * where they turn out to be defects, become assertions in the normal suites
 * against a small committed fixture.
 *
 * It runs everything rather than only what we predict will break. 10.1 is the
 * reason: the prediction named two tools and the defect was in three, and only
 * running the lot found the third.
 *
 * JPG-to-PDF is absent because it does not take a PDF at all.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, BASE, TMP } from "./harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/real-corpus.json"), "utf8"));
const DIR = path.join(ROOT, manifest.dir);
const BUDGET = Number(process.env.PROBE_TIMEOUT || 120000);   // per tool per file
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;

if(!fs.existsSync(DIR)){
  console.error(`${manifest.dir}/ does not exist — run \`npm run fetch-real\` first.`);
  process.exit(1);
}
const FILES = fs.readdirSync(DIR).filter(n => n.endsWith(".pdf")).sort()
  .filter(n => !ONLY || ONLY.includes(n));

/* `prep` makes a tool actionable when its default state isn't. `mate` is a
   second file for tools that need more than one. */
const TOOLS = {
  merge:          { mate: "alpha.pdf" },
  split:          {},
  organize:       {},
  rotate:         { prep: p => p.locator('.page-tile [data-action="right"]').first().click() },
  "page-numbers": {},
  watermark:      {},
  "pdf-to-jpg":   {}
};

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms / 1000}s at ${label}`)), ms))
]);

const { browser, page, errors } = await launch();

/* What came out: page count for a PDF, entry count for a ZIP, else the type. */
async function describeOutput(file){
  const bytes = fs.readFileSync(file.path);
  if(file.name.endsWith(".pdf")){
    const n = await page.evaluate(async arr => {
      const pdfjsLib = await window.ilikepdf.loadPdfJs();
      return (await pdfjsLib.getDocument({ data: new Uint8Array(arr) }).promise).numPages;
    }, [...bytes]);
    return `${n}p`;
  }
  if(file.name.endsWith(".zip")){
    const n = await page.evaluate(async arr => {
      const JSZip = await window.ilikepdf.loadZip();
      return Object.keys((await JSZip.loadAsync(new Uint8Array(arr))).files).length;
    }, [...bytes]);
    return `zip×${n}`;
  }
  return path.extname(file.name).slice(1);
}

async function run(tool, pdf){
  const cfg = TOOLS[tool];
  const started = Date.now();
  const mark = errors.length;
  const out = { tool, pdf, note: "", result: "", ms: 0, errs: 0 };

  await page.goto(`${BASE}/${tool}.html`, { waitUntil: "networkidle" });

  const inputs = [path.join(DIR, pdf)];
  if(cfg.mate) inputs.push(path.join(ROOT, "tests/fixtures", cfg.mate));
  const multiple = await page.evaluate(() => document.getElementById("fileInput").multiple);
  await page.setInputFiles("#fileInput", multiple ? inputs : inputs[0]);

  // The document either opens or is refused on the hero. Wait for whichever.
  await page.waitForFunction(() =>
    document.querySelector("#workspace.on") || document.querySelector("#heroError.on"),
    null, { timeout: 30000 });

  if(await page.locator("#heroError.on").count()){
    out.result = "REFUSED";
    out.note = (await page.locator("#heroError").textContent()).trim().slice(0, 80);
    out.ms = Date.now() - started;
    out.errs = errors.length - mark;
    return out;
  }

  out.note = (await page.locator(".panel .error").textContent().catch(() => "")).trim().slice(0, 80);

  if(cfg.prep){
    try{ await cfg.prep(page); }catch{ /* nothing to prep on a 1-page doc, fine */ }
  }

  if(await page.locator(".btn-action").isDisabled()){
    out.result = "BLOCKED: " + (await page.locator(".btn-action").textContent()).trim();
    out.ms = Date.now() - started;
    out.errs = errors.length - mark;
    return out;
  }

  /* Wait for the export to finish *either way*. Watching only for #done.on
     turns a tool that correctly reported a failure into a 'timeout', which is
     how the first run of this probe mis-read every encrypted file. The progress
     bar carries .on for exactly as long as the work runs. */
  await page.locator(".btn-action").click();
  await page.waitForFunction(() => {
    if(document.querySelector("#done.on")) return true;
    const busy = document.querySelector(".panel .bar")?.classList.contains("on");
    const err = document.querySelector(".panel .error");
    return !busy && err && err.classList.contains("on") && err.textContent.trim().length > 0;
  }, null, { timeout: BUDGET });

  if(!(await page.locator("#done.on").count())){
    out.result = "EXPORT FAILED";
    out.note = (await page.locator(".panel .error").textContent()).trim().slice(0, 80);
    out.ms = Date.now() - started;
    out.errs = errors.length - mark;
    return out;
  }

  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.locator("#downloadBtn").click()
  ]);
  const saved = path.join(TMP, `${tool}-${dl.suggestedFilename()}`);
  await dl.saveAs(saved);
  out.result = await describeOutput({ name: dl.suggestedFilename(), path: saved });
  out.ms = Date.now() - started;
  out.errs = errors.length - mark;
  return out;
}

const rows = [];
console.log(`\nphase 10 sweep — ${FILES.length} files × ${Object.keys(TOOLS).length} tools, ${BUDGET / 1000}s budget each\n`);

for(const pdf of FILES){
  const size = (fs.statSync(path.join(DIR, pdf)).size / 1024).toFixed(0);
  console.log(`${pdf}  (${size} KB)`);
  for(const tool of Object.keys(TOOLS)){
    let row;
    try{
      row = await withTimeout(run(tool, pdf), BUDGET + 60000, tool);
    }catch(e){
      row = { tool, pdf, note: "", result: "FAIL: " + e.message.split("\n")[0].slice(0, 60), ms: 0, errs: 0 };
    }
    rows.push(row);
    const flag = /FAIL|REFUSED|BLOCKED/.test(row.result) ? "  <<<" : "";
    console.log(`   ${row.tool.padEnd(13)} ${String(row.result).padEnd(28)} ${String(row.ms + "ms").padStart(8)}` +
                `${row.errs ? "  " + row.errs + " console err" : ""}${flag}`);
    if(row.note) console.log(`   ${" ".repeat(13)} note: ${row.note}`);
  }
}

/* The report, so a finding can be quoted into NEXT.md rather than re-derived. */
const md = ["# Phase 10 sweep", "", `Run ${new Date().toISOString()} against \`${BASE}\`.`, "",
  "| file | tool | result | ms | console | note |", "|---|---|---|---:|---:|---|",
  ...rows.map(r => `| ${r.pdf} | ${r.tool} | ${r.result} | ${r.ms} | ${r.errs || ""} | ${r.note.replace(/\|/g, "\\|")} |`)];
fs.writeFileSync(path.join(ROOT, "tmp/real-report.md"), md.join("\n") + "\n");

const bad = rows.filter(r => /FAIL|REFUSED|BLOCKED/.test(r.result));
console.log(`\n${rows.length} runs, ${bad.length} not a clean export. Report: tmp/real-report.md`);
if(bad.length){
  console.log("\nneeds a look:");
  for(const r of bad) console.log(`  ${r.pdf.padEnd(28)} ${r.tool.padEnd(13)} ${r.result}`);
}

await browser.close();
