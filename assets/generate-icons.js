// Run with: node assets/generate-icons.js
//
// Converts assets/icon.svg → assets/icon.png (256x256) using Electron's offscreen
// rendering. Run once whenever the SVG changes. The PNG is what the BrowserWindow
// loads as the taskbar icon during dev. For packaged builds, also convert the
// SVG to a multi-resolution .ico via your packager (electron-builder handles
// this automatically when given a 256x256 PNG via build.win.icon).
//
// Requires Electron (already a devDependency). Spins up a hidden window, loads
// the SVG, captures the page, writes a PNG.

const path = require("path");
const fs = require("fs");

const electron = require("electron");

if (typeof electron === "string") {
  // Running under plain Node — re-exec under Electron.
  const { spawnSync } = require("child_process");
  const result = spawnSync(electron, [__filename], { stdio: "inherit" });
  process.exit(result.status ?? 0);
}

const { app, BrowserWindow } = electron;

const svgPath = path.join(__dirname, "icon.svg");
const pngPath = path.join(__dirname, "icon.png");
const buildIconPath = path.join(__dirname, "..", "build", "icon.png");

async function renderAt(size, outputPath) {
  const svg = fs.readFileSync(svgPath, "utf8");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body { margin:0; padding:0; background: transparent; }
    svg { display: block; width: ${size}px; height: ${size}px; }
  </style></head><body>${svg}</body></html>`;

  // Write HTML to a temp file to avoid the data: URL length limit Chromium
  // imposes (data URLs over ~2MB fail with ERR_FAILED at higher sizes).
  const tmpHtml = path.join(__dirname, `.icon-render-${size}.html`);
  fs.writeFileSync(tmpHtml, html);

  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: false }
  });

  try {
    await win.loadFile(tmpHtml);
    // Give the SVG a tick to lay out fonts.
    await new Promise((r) => setTimeout(r, 250));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(outputPath, image.toPNG());
    console.log("Wrote", outputPath, `(${(fs.statSync(outputPath).size / 1024).toFixed(1)}KB)`);
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmpHtml); } catch { /* noop */ }
  }
}

app.whenReady().then(async () => {
  // 256x256: in-app taskbar icon during dev (used by BrowserWindow.icon)
  await renderAt(256, pngPath);
  // 512x512: source for electron-builder to derive .ico (Windows) and
  // .icns (macOS) at multiple resolutions. 512 is the minimum electron-
  // builder recommends; 1024 would be ideal but runs into BrowserWindow
  // size limits on some displays.
  await renderAt(512, buildIconPath);
  app.quit();
});
