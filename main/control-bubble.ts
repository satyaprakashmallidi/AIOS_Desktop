// Computer Control bubble — small always-on-top circle that floats at
// the top-right of the user's primary display. Clicking it toggles the
// larger Computer Control panel window. Modeled after macOS menu-bar
// app icons (TipTour, Linear, Raycast) — a persistent presence the user
// can summon from any app without alt-tabbing into AIOS.
//
// Lifecycle:
//   - Created lazily on first show (via toggleControlBubble or hotkey).
//   - Hidden on close instead of destroyed; keeps state warm.
//   - Subscribed to aios:host-event broadcasts so its renderer can show
//     a tiny indicator dot while a voice loop is mid-run (future).

import { BrowserWindow, screen } from "electron";
import * as path from "node:path";

const BUBBLE_SIZE = 56;          // includes ~6px transparent margin for shadow
const SCREEN_EDGE_MARGIN = 16;

let bubbleWindow: BrowserWindow | null = null;
let onSubscribe: ((win: BrowserWindow) => void) | null = null;
let onUnsubscribe: ((win: BrowserWindow) => void) | null = null;
// Callbacks fired whenever the user drags the bubble. control-popup.ts
// subscribes so the panel underneath snaps to follow the bubble's new
// position — making the bubble the single anchor for the whole UI.
const moveListeners = new Set<() => void>();

export function onBubbleMove(cb: () => void): () => void {
  moveListeners.add(cb);
  return () => { moveListeners.delete(cb); };
}

export interface ControlBubbleHooks {
  subscribe: (win: BrowserWindow) => void;
  unsubscribe: (win: BrowserWindow) => void;
}

export function installControlBubbleHooks(hooks: ControlBubbleHooks): void {
  onSubscribe = hooks.subscribe;
  onUnsubscribe = hooks.unsubscribe;
}

function bubbleOrigin(): { x: number; y: number } {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  return {
    x: x + width - BUBBLE_SIZE - SCREEN_EDGE_MARGIN,
    y: y + SCREEN_EDGE_MARGIN,
  };
}

let bubbleQuitting = false;
export function markBubbleQuitting(): void { bubbleQuitting = true; }

function ensureBubble(): BrowserWindow {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) return bubbleWindow;

  const isMac = process.platform === "darwin";
  const origin = bubbleOrigin();
  const win = new BrowserWindow({
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    x: origin.x,
    y: origin.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    // Same DWM halo fix as the panel — kill thick frame + native rounded
    // corners so Windows doesn't draw a shadow around the transparent
    // bubble window.
    thickFrame: false,
    roundedCorners: false,
    type: isMac ? "panel" : undefined,
    title: "AIOS Control Bubble",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // "screen-saver" is the highest Electron z-level — beats Win/Mac
  // taskbars and almost every other window. Without this, on Windows
  // the bubble was getting slipped under foreground apps the moment
  // they took focus.
  win.setAlwaysOnTop(true, "screen-saver");

  if (isMac) {
    try {
      (win as unknown as { setHiddenInMissionControl?: (h: boolean) => void }).setHiddenInMissionControl?.(true);
    } catch { /* non-fatal */ }
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(`${devUrl}?aios-control-bubble=1`);
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { search: "aios-control-bubble=1" });
  }

  win.on("close", (event) => {
    if (!bubbleQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // Fires when the user finishes dragging the bubble. Notify subscribers
  // (the panel uses this to track the bubble's position).
  win.on("moved", () => {
    for (const cb of moveListeners) {
      try { cb(); } catch { /* one subscriber's failure shouldn't break others */ }
    }
  });

  win.on("closed", () => {
    if (onUnsubscribe && bubbleWindow) onUnsubscribe(bubbleWindow);
    bubbleWindow = null;
  });

  if (onSubscribe) onSubscribe(win);
  bubbleWindow = win;
  return win;
}

export function getBubbleBounds(): { x: number; y: number; width: number; height: number } | null {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) return null;
  return bubbleWindow.getBounds();
}

export function isBubbleVisible(): boolean {
  return !!(bubbleWindow && !bubbleWindow.isDestroyed() && bubbleWindow.isVisible());
}

export function showControlBubble(): void {
  const win = ensureBubble();
  if (!win.isVisible()) {
    const origin = bubbleOrigin();
    win.setPosition(origin.x, origin.y, false);
    win.showInactive();
  }
}

export function hideControlBubble(): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
}

export function toggleControlBubble(): void {
  if (isBubbleVisible()) {
    hideControlBubble();
  } else {
    showControlBubble();
  }
}

export function destroyControlBubble(): void {
  markBubbleQuitting();
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.destroy();
  bubbleWindow = null;
}
