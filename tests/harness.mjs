/* Shared plumbing for the browser smoke tests. Dev tooling — not shipped.
 *
 *   python3 -m http.server 8000 &
 *   npm install && npx playwright install chromium
 *   npm test
 *
 * BASE overrides the URL, CHROME overrides the browser binary.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const BASE = process.env.BASE || "http://localhost:8000";
export const FIX = path.join(HERE, "fixtures");
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ilikepdf-"));

function findChrome(){
  if(process.env.CHROME) return process.env.CHROME;
  // PLAYWRIGHT_BROWSERS_PATH first: sandboxes and CI images pre-install browsers
  // there, and their build number rarely matches whatever playwright-core wants
  // by default — which fails with "run npx playwright install" on a machine that
  // already has a perfectly good Chromium.
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH,
                 path.join(os.homedir(), ".cache/ms-playwright")].filter(Boolean);
  for(const root of roots){
    if(!fs.existsSync(root)) continue;
    for(const dir of fs.readdirSync(root).filter(d => d.startsWith("chromium-")).sort().reverse()){
      for(const rel of ["chrome-linux64/chrome", "chrome-linux/chrome",
                        "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]){
        const p = path.join(root, dir, rel);
        if(fs.existsSync(p)) return p;
      }
    }
  }
  return undefined;   // let playwright-core try its default
}

/* Opens a page that records every console error, uncaught exception, and 4xx/5xx
   response, so "no console errors" can be asserted at the end of a run. */
export async function launch({ viewport } = {}){
  const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ acceptDownloads: true, viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", m => { if(m.type() === "error") errors.push(m.text() + " @ " + JSON.stringify(m.location())); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("response", r => { if(r.status() >= 400) errors.push("HTTP " + r.status() + " " + r.url()); });
  return { browser, page, errors };
}

export function suite(title){
  const pass = [], fail = [];

  const check = (name, ok, detail = "") =>
    (ok ? pass : fail).push(name + (detail ? "  → " + detail : ""));

  function report(){
    console.log("\n" + title + " — artifacts in " + TMP);
    console.log("PASS (" + pass.length + ")");
    pass.forEach(p => console.log("  ✓ " + p));
    if(fail.length){
      console.log("\nFAIL (" + fail.length + ")");
      fail.forEach(f => console.log("  ✗ " + f));
      process.exitCode = 1;
      return false;
    }
    console.log("\nall green");
    return true;
  }

  return { check, report };
}
