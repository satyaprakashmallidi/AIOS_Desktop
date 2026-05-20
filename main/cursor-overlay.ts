// Cursor companion overlay window.
//
// Fullscreen, transparent, always-on-top, CLICK-THROUGH BrowserWindow
// that draws a soft companion next to the user's cursor. Updated at
// ~60Hz by polling screen.getCursorScreenPoint() in the main process
// and pushing the position to the overlay renderer via a dedicated IPC
// channel.
//
// The window is positioned at the primary display's full bounds (NOT
// workArea) so the cursor can be in the menu bar / taskbar area and
// still match. setIgnoreMouseEvents(true) is critical — without it the
// fullscreen overlay would eat every click.

import { BrowserWindow, screen } from "electron";
import * as path from "node:path";
import type { PythonHost } from "./python-host";

let overlayWindow: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let typeTimer: NodeJS.Timeout | null = null;
let pythonHost: PythonHost | null = null;
let active = false;
let quitting = false;
let cursorColor = "#9caf9b"; // default = AIOS sage; user can change.
let lastCursorType = "arrow";

export function setCursorOverlayHost(host: PythonHost): void {
  pythonHost = host;
}

export function isCursorOverlayActive(): boolean { return active; }
export function getCursorColor(): string { return cursorColor; }

export function setCursorColor(color: string): void {
  if (!color || typeof color !== "string") return;
  cursorColor = color;
  // Push to the overlay renderer if it's already running.
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send("aios:cursor-color", cursorColor);
  }
}

// Visually fly the cursor companion from its current position to a target
// over `durationMs`. Used by voice-control.ts before each grounded CLICK
// so the user sees the agent's intent ~0.25s before pyautogui actually
// fires the click. No-op if the overlay isn't active.
export function flyCursorTo(target: { x: number; y: number; durationMs?: number }): void {
  if (!active || !overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const { x, y } = display.bounds;
  overlayWindow.webContents.send("aios:cursor-fly-to", {
    x: target.x - x,
    y: target.y - y,
    durationMs: target.durationMs ?? 250,
  });
}

// Push a one-shot status message that the overlay renders as a small
// text bubble next to the companion. Auto-dismisses after `durationMs`.
export function showCursorMessage(text: string, durationMs: number = 2200): void {
  if (!active || !overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send("aios:cursor-message", { text, durationMs });
}

// Notify the overlay that the agent is "thinking" (or done thinking).
// Renderer swaps the cursor sprite for a spinner while true.
export function setCursorBusy(busy: boolean): void {
  if (!active || !overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send("aios:cursor-busy", { busy });
}

export function setCursorOverlayActive(next: boolean): void {
  if (next === active) return;
  active = next;
  if (next) show();
  else hide();
}

function ensureOverlay(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;

  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    type: isMac ? "panel" : undefined,
    title: "AIOS Cursor Companion",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Click-through: pointer events pass straight to the app underneath.
  win.setIgnoreMouseEvents(true, { forward: false });
  // Stay above everything, on every Space, over fullscreen apps.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, "screen-saver");

  if (isMac) {
    try {
      (win as unknown as { setHiddenInMissionControl?: (h: boolean) => void }).setHiddenInMissionControl?.(true);
    } catch { /* non-fatal */ }
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(`${devUrl}?aios-cursor-overlay=1`);
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { search: "aios-cursor-overlay=1" });
  }

  // Push the current color the moment the renderer is ready, so the
  // companion paints with the right color on first frame.
  win.webContents.once("did-finish-load", () => {
    if (!win.isDestroyed()) {
      win.webContents.send("aios:cursor-color", cursorColor);
    }
  });

  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    overlayWindow = null;
  });

  overlayWindow = win;
  return win;
}

function show(): void {
  const win = ensureOverlay();
  // Re-set bounds in case the primary display changed since last show.
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.bounds;
  win.setBounds({ x, y, width, height }, false);
  // showInactive — never steal focus from whatever app the user is using.
  win.showInactive();

  if (pollTimer) clearInterval(pollTimer);
  let lastSent: { x: number; y: number } | null = null;
  pollTimer = setInterval(() => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
    const point = screen.getCursorScreenPoint();
    // De-dupe: skip IPC when the cursor hasn't moved (saves work when the
    // user is reading / typing).
    if (lastSent && lastSent.x === point.x && lastSent.y === point.y) return;
    lastSent = point;
    overlayWindow.webContents.send("aios:cursor-position", {
      // Translate screen-space to overlay-window client-space (subtract
      // the window's origin). On the primary display starting at (0,0)
      // this is a no-op, but it's correct for displays that start elsewhere.
      x: point.x - x,
      y: point.y - y,
    });
  }, 16);

  // 10Hz cursor TYPE poll (much lower than position) — calls Python's
  // voice_get_cursor_type which inspects the active OS cursor handle.
  // Lets the companion swap between arrow / I-beam / hand / spinner
  // sprites so it matches what the user is interacting with.
  if (typeTimer) clearInterval(typeTimer);
  typeTimer = setInterval(async () => {
    if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return;
    if (!pythonHost) return;
    try {
      const res = await pythonHost.invoke<{ available: boolean; type: string }>("voice_get_cursor_type", {});
      if (res.ok && res.data?.available) {
        const nextType = res.data.type || "arrow";
        if (nextType !== lastCursorType) {
          lastCursorType = nextType;
          overlayWindow.webContents.send("aios:cursor-type", nextType);
        }
      }
    } catch { /* host not ready or call failed — try again next tick */ }
  }, 100);
}

function hide(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide();
}

export function destroyCursorOverlay(): void {
  quitting = true;
  hide();
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
  overlayWindow = null;
}
