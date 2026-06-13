import { execSync } from "child_process";
import { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, cpSync } from "fs";
import { createReadStream, createWriteStream, promises as fsp } from "fs";
import { resolve, dirname } from "path";
import { ZipArchive } from "archiver";

const root = resolve(import.meta.dirname, "..");
const tmp = resolve(root, "scf-tmp");
const zipPath = resolve(root, "scf-deploy.zip");
const nmRoot = resolve(root, "node_modules");

// 1. Compile TypeScript
console.log("Building...");
execSync("npx tsc -p tsconfig.scf.json", { cwd: root, stdio: "inherit" });

// 2. Prepare clean directory
console.log("Preparing package...");
if (existsSync(tmp)) rmSync(tmp, { recursive: true });
mkdirSync(tmp, { recursive: true });

function cp(src, dest) {
  const d = resolve(tmp, dest);
  mkdirSync(dirname(d), { recursive: true });
  copyFileSync(resolve(root, src), d);
}

// Entry file
cp("scf-main.js", "scf-main.js");

// Compiled src/*.js
for (const f of readdirSync(resolve(root, "src"))) {
  if (f.endsWith(".js")) cp("src/" + f, "src/" + f);
}
// src/data/*.js
const dataDir = resolve(root, "src/data");
if (existsSync(dataDir)) {
  mkdirSync(resolve(tmp, "src/data"), { recursive: true });
  for (const f of readdirSync(dataDir)) {
    if (f.endsWith(".js")) cp("src/data/" + f, "src/data/" + f);
  }
}

// Package files: set "type": "commonjs" explicitly for SCF CJS compat
const pkgJson = JSON.parse(await fsp.readFile(resolve(root, "package.json"), "utf8"));
pkgJson.type = "commonjs";
await fsp.writeFile(resolve(tmp, "package.json"), JSON.stringify(pkgJson, null, 2));
cp("package-lock.json", "package-lock.json");

// 3. Copy production node_modules only
console.log("Copying node_modules...");
const resultDir = resolve(tmp, "node_modules");
mkdirSync(resultDir, { recursive: true });

const prodPaths = execSync("npm ls --omit=dev --all --parseable", { cwd: root })
  .toString().trim().split("\n").filter(Boolean);

const nmSep = nmRoot + (nmRoot.endsWith("/") || nmRoot.endsWith("\\") ? "" : "\\");
for (const p of prodPaths) {
  if (!p || resolve(root, p) === root) continue;
  // p is absolute, compute relative path under node_modules
  const abs = resolve(root, p);
  if (!abs.startsWith(nmRoot)) continue;
  const rel = abs.slice(nmSep.length); // e.g. "@upstash/redis" or "scoped/pkg"
  const dest = resolve(resultDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  await fsp.cp(abs, dest, { recursive: true, errorOnExist: false });
}

const count = prodPaths.filter(p => p && resolve(root, p) !== root).length;
console.log("  " + count + " packages");

// 4. Create zip
console.log("Zipping...");
if (existsSync(zipPath)) rmSync(zipPath);

const output = createWriteStream(zipPath);
const archive = new ZipArchive();
archive.pipe(output);
archive.directory(tmp, false);
await archive.finalize();

// 5. Cleanup
rmSync(tmp, { recursive: true });

const size = Math.round((await fsp.stat(zipPath)).size / 1024);
console.log("Done: scf-deploy.zip (" + size + " KB)");
