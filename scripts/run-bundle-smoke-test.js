// Bundle smoke test — invoked after `npm run build:python` to verify
// the freshly-built PyInstaller sidecar can import every package its
// runtime code reaches for. Catches bundling regressions (e.g. the
// v0.2.13 SpeechRecognition crash on Mac) BEFORE we ship an installer.
//
// The sidecar accepts a `--smoke-import` CLI flag (see _smoke_import()
// in python/host.py). It exits 0 on success, 1 on the first missing
// module. We propagate that exit code so the CI step fails loudly.
//
// Run locally as `npm run test:bundle` after a local PyInstaller build.

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const distDir = path.resolve(__dirname, "..", "dist", "aios-host");
const isWin = process.platform === "win32";
const exeName = isWin ? "aios-host.exe" : "aios-host";
const exePath = path.join(distDir, exeName);

if (!fs.existsSync(exePath)) {
  console.error(`Bundle smoke test: binary not found at ${exePath}`);
  console.error("Run `npm run build:python` first.");
  process.exit(1);
}

console.log(`Bundle smoke test: invoking ${exePath} --smoke-import`);
const result = spawnSync(exePath, ["--smoke-import"], {
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`Bundle smoke test: spawn failed: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
