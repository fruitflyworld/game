// check.mjs — static integrity of a no-build game:
//   1. every js file parses (node --check)
//   2. every local file referenced by index.html exists
//   3. every relative ES-module import in js/ resolves
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const fail = (msg) => { failures++; console.error("FAIL " + msg); };

// 1. syntax
function walkJs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walkJs(p));
    else if (e.endsWith(".js")) out.push(p);
  }
  return out;
}
const jsFiles = walkJs(join(root, "js")).concat(walkJs(join(root, "scripts")));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { fail(`syntax: ${relative(root, f)}`); }
}

// 2. index.html references
const html = readFileSync(join(root, "index.html"), "utf8");
for (const m of html.matchAll(/(?:src|href)="(\.{0,2}\/[^"]+)"/g)) {
  const p = m[1].replace(/^\.\//, "");
  if (!existsSync(join(root, p))) fail(`index.html references missing file: ${p}`);
}

// 3. module imports resolve
const importRe = /from\s+["'](\.[^"']+)["']|import\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
for (const f of walkJs(join(root, "js"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(importRe)) {
    const spec = m[1] || m[2];
    if (!existsSync(join(dirname(f), spec))) {
      fail(`${relative(root, f)} imports missing module: ${spec}`);
    }
  }
}

console.log(`checked ${jsFiles.length} js files, index.html references, and relative imports`);
process.exit(failures ? 1 : 0);
