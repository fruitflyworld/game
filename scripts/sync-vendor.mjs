#!/usr/bin/env node
/* ── scripts/sync-vendor.mjs ─────────────────────────────────────────────────
   One-command vendoring between the fruitflyworld repos. Arrows point one
   way: sim → game → fruit-fly-world. Never edit a vendored copy downstream;
   change it upstream and run this.

     node scripts/sync-vendor.mjs check   # verify fingerprints vs vendor.lock.json (CI)
     node scripts/sync-vendor.mjs pull    # copy from upstream checkouts + update lock
     node scripts/sync-vendor.mjs status  # show drift without changing anything

   Upstream checkouts are resolved per source, in order:
     1. env var listed in the lock entry (e.g. FFW_SIM_DIR)
     2. a sibling checkout:  <parent>/ffw-<name>   (name from the repo field)
     3. git clone depth 1 into .vendor-cache/<name> (pull only)

   The lock records the upstream commit hash — stronger than a version label:
   "these exact bytes, from that exact commit".
   ------------------------------------------------------------------------- */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const MODE = process.argv[2] || "status";
if (!["check", "pull", "status"].includes(MODE)) {
  console.error("usage: node scripts/sync-vendor.mjs check|pull|status");
  process.exit(2);
}
const LOCK_PATH = path.join(process.cwd(), "vendor.lock.json");
if (!existsSync(LOCK_PATH)) {
  console.error("no vendor.lock.json in " + process.cwd());
  process.exit(2);
}
const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));

const sha256 = (p) => "sha256:" + createHash("sha256").update(readFileSync(p)).digest("hex");

function upstreamDir(entry, name, forClone) {
  if (entry.dirEnv && process.env[entry.dirEnv]) return process.env[entry.dirEnv];
  const guess = path.resolve(process.cwd(), "..", "ffw-" + name);
  if (existsSync(guess)) return guess;
  const nested = path.resolve(process.cwd(), "..", name);
  if (existsSync(nested)) return nested;
  if (forClone) {
    const cache = path.join(process.cwd(), ".vendor-cache", name);
    if (!existsSync(cache)) {
      mkdirSync(path.dirname(cache), { recursive: true });
      execFileSync("git", ["clone", "--depth", "1",
        `https://github.com/${entry.repo}.git`, cache], { stdio: "inherit" });
    }
    return cache;
  }
  return null;
}

let drift = 0;
for (const [name, entry] of Object.entries(lock.sources)) {
  const dir = upstreamDir(entry, name, MODE === "pull");
  const rev = dir
    ? execFileSync("git", ["-C", dir, "rev-parse", "HEAD"]).toString().trim()
    : null;

  if (MODE === "status") {
    console.log(`${name}: locked rev ${entry.rev?.slice(0, 8) ?? "?"}${rev ? ` / upstream ${rev.slice(0, 8)}` : " / upstream not found"}`);
  }

  for (const [dest, want] of Object.entries(entry.files)) {
    const src = entry.stripPrefix
      ? dest.slice(entry.stripPrefix.length) // dest path minus prefix = upstream path
      : dest;
    const upstreamFile = dir && path.join(dir, src);
    const localFile = path.join(process.cwd(), dest);

    if (MODE === "pull") {
      if (!upstreamFile || !existsSync(upstreamFile)) {
        console.error(`  MISSING upstream ${name}/${src} -> ${dest}`);
        drift++; continue;
      }
      mkdirSync(path.dirname(localFile), { recursive: true });
      copyFileSync(upstreamFile, localFile);
      entry.files[dest] = sha256(localFile);
      console.log(`  pulled ${name}/${src} -> ${dest}`);
      continue;
    }

    // check / status: compare local file against the locked fingerprint
    if (!existsSync(localFile)) {
      console.error(`  ✗ ${dest}: missing (run: node scripts/sync-vendor.mjs pull)`);
      drift++; continue;
    }
    const got = sha256(localFile);
    if (got !== want) {
      console.error(`  ✗ ${dest}: fingerprint mismatch — this file is vendored from ${name}.`);
      console.error(`      Change it upstream (${entry.repo}) and re-sync; do not edit the copy.`);
      drift++;
    } else if (MODE === "check") {
      console.log(`  ✓ ${dest}`);
    }
  }
  if (MODE === "pull" && rev) entry.rev = rev;
}

if (MODE === "pull") {
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");
  console.log("vendor.lock.json updated.");
}

if (drift > 0) {
  console.error(`\n${drift} vendored file(s) out of sync.`);
  process.exit(1);
}
console.log("\nAll vendored files match vendor.lock.json.");
