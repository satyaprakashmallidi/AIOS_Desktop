/**
 * Copy non-TypeScript assets from main/ to dist/main/ after the TypeScript
 * compiler has run. tsc only emits .ts files; anything checked into main/ as
 * plain .js (e.g. whatsapp-worker.js — a forked child process script) gets
 * silently dropped, which means the production install is missing files that
 * the compiled main process tries to spawn at runtime.
 *
 * Run by the npm build script:  tsc -p tsconfig.main.json && node scripts/copy-main-assets.cjs
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "main");
const DST = path.join(__dirname, "..", "dist", "main");

// Only files we explicitly want to ship as-is. (Don't blanket-copy main/* —
// that'd include stray ts.bak or .tsbuildinfo files etc.)
const COPY_EXTENSIONS = new Set([".js"]);

fs.mkdirSync(DST, { recursive: true });

let copied = 0;
for (const entry of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const ext = path.extname(entry.name);
  if (!COPY_EXTENSIONS.has(ext)) continue;
  const from = path.join(SRC, entry.name);
  const to = path.join(DST, entry.name);
  fs.copyFileSync(from, to);
  console.log(`copy-main-assets: ${entry.name} → dist/main/`);
  copied++;
}

console.log(`copy-main-assets: ${copied} file(s) copied.`);
