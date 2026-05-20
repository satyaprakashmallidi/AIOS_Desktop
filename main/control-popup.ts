// Computer Control popup window.
//
// A small, borderless, always-on-top BrowserWindow that lives at the top
// right of the user's primary display — independent of the AIOS main
// window. TipTour-style: appears over any app, doesn't activate (doesn't
// steal focus from whatever the user was doing), survives Cmd-Tab.
//
// The renderer loads the same index.html with a ?aios-control=1 flag, so
// App.tsx branches into ControlApp (a minimal wrapper that mounts only
// the VoiceControlPanel) instead of the full sidebar app.

import { BrowserWindow, screen } from "electron";
import * as path from "node:path";
import { getBubbleBounds, onBubbleMove } from "./control-bubble";

// Sized to feel like a chat tooltip drawer beneath the bubble — small
// enough to read at a glance, scrolls internally for long transcripts.
const POPUP_WIDTH = 320;
const POPUP_HEIGHT = 460;
const SCREEN_EDGE_MARGIN = 16;
const BUBBLE_GAP = 6;

let popupWindow: BrowserWindow | null = null;
let onSubscribe: ((win: BrowserWindow) => void) | null = null;
let onUnsubscribe: ((win: BrowserWindow) => void) | null = null;

// Dock mode tracks whether the panel auto-snaps under the bubble on each
// open (true) or restores its last manually-placed position (false). User
// toggles it from the pin button in the panel header. Bounds are captured
// on every move in undocked mode so reopen lands where they left it.
let panelDocked = true;
let undockedBounds: { x: number; y: number } | null = null;

// When the user drags the bubble, drag the panel along with it (only
// when the panel is currently visible AND in docked mode — undocked
// means the user explicitly placed the panel and doesn't want it
// snapping back). Subscribed once at module load; same callback for
// the life of the process.
onBubbleMove(() => {
  if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return;
  if (!panelDocked) return;
  const origin = topRightOrigin();
  popupWindow.setPosition(origin.x, origin.y, false);
});

export function isPanelDocked(): boolean { return panelDocked; }
export function setPanelDocked(docked: boolean): void {
  panelDocked = docked;
  // If they just docked, snap the window under the bubble immediately so
  // there's visible feedback. If they just undocked, leave it where it is
  // and remember that position.
  if (docked && popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
    const origin = topRightOrigin();
    popupWindow.setPosition(origin.x, origin.y, false);
  } else if (!docked && popupWindow && !popupWindow.isDestroyed()) {
    const [x, y] = popupWindow.getPosition();
    undockedBounds = { x, y };
  }
  popupWindow?.webContents?.send("aios:control-panel-docked", panelDocked);
}

export interface ControlPopupHooks {
  // Called when the popup window is created so main.ts can register it
  // as an event subscriber (aios:host-event broadcast target).
  subscribe: (win: BrowserWindow) => void;
  unsubscribe: (win: BrowserWindow) => void;
}

export function installControlPopupHooks(hooks: ControlPopupHooks): void {
  onSubscribe = hooks.subscribe;
  onUnsubscribe = hooks.unsubscribe;
}

function topRightOrigin(): { x: number; y: number } {
  // Undocked: restore the user's manually-placed position.
  if (!panelDocked && undockedBounds) return undockedBounds;
  // Docked: snap under the bubble (right-edge aligned) when it exists,
  // else screen top-right corner.
  const bubble = getBubbleBounds();
  if (bubble) {
    return {
      x: bubble.x + bubble.width - POPUP_WIDTH,
      y: bubble.y + bubble.height + BUBBLE_GAP,
    };
  }
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  return {
    x: x + width - POPUP_WIDTH - SCREEN_EDGE_MARGIN,
    y: y + SCREEN_EDGE_MARGIN,
  };
}

function ensurePopup(): BrowserWindow {
  if (popupWindow && !popupWindow.isDestroyed()) return popupWindow;

  const isMac = process.platform === "darwin";
  const origin = topRightOrigin();
  const win = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
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
    // Disable the Windows WS_THICKFRAME styling — for frame:false windows
    // it adds a 1px chrome border and subtle DWM drop shadow that reads
    // as a "black halo" around our dark rounded popup. Off = a clean
    // transparent margin around the rounded corners.
    thickFrame: false,
    roundedCorners: false,
    // On Mac, "panel" gives NSPanel behavior — non-activating (doesn't
    // steal focus from the underlying app) and stays above regular
    // windows. Lets TipTour-style "speak from any app" work.
    type: isMac ? "panel" : undefined,
    title: "AIOS Control",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Keep it visible across all macOS spaces and over fullscreen apps.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // "screen-saver" is the highest Electron z-level — beats Win/Mac
  // taskbars and almost every other window. "floating" wasn't enough
  // on Windows: foreground apps slipped over the panel when they
  // took focus.
  win.setAlwaysOnTop(true, "screen-saver");

  // Don't show in the dock/task switcher.
  if (isMac) {
    try {
      // Soft-undocumented but commonly used to keep panel out of Cmd-Tab.
      // No-op on platforms that don't implement it.
      (win as unknown as { setHiddenInMissionControl?: (h: boolean) => void }).setHiddenInMissionControl?.(true);
    } catch {
      /* non-fatal */
    }
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(`${devUrl}?aios-control=1`);
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"), { search: "aios-control=1" });
  }

  // Closing the popup just hides it — we keep the renderer warm so the
  // next open is instant. The window is fully destroyed only on app quit.
  win.on("close", (event) => {
    if (!app_isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  // When undocked, remember the most recent position so a subsequent
  // open-close-open cycle restores the user's chosen spot instead of
  // snapping back to the default.
  win.on("moved", () => {
    if (!panelDocked && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      undockedBounds = { x, y };
    }
  });

  win.on("closed", () => {
    if (onUnsubscribe && popupWindow) onUnsubscribe(popupWindow);
    popupWindow = null;
  });

  if (onSubscribe) onSubscribe(win);

  popupWindow = win;
  return win;
}

// Lightweight quit-flag indirection so we can tear down the window cleanly
// when the app is actually quitting (won't intercept the close handler).
let appIsQuitting = false;
function app_isQuitting(): boolean {
  return appIsQuitting;
}

export function markAppQuitting(): void {
  appIsQuitting = true;
}

export function toggleControlPopup(): void {
  const win = ensurePopup();
  if (win.isVisible()) {
    win.hide();
  } else {
    // Re-position to top-right in case the primary display changed.
    const origin = topRightOrigin();
    win.setPosition(origin.x, origin.y, false);
    // showInactive avoids stealing focus from whatever app the user was
    // working in — the whole point of a TipTour-style panel.
    win.showInactive();
  }
}

export function openControlPopup(): void {
  const win = ensurePopup();
  if (!win.isVisible()) {
    const origin = topRightOrigin();
    win.setPosition(origin.x, origin.y, false);
    win.showInactive();
  }
}

export function closeControlPopup(): void {
  if (popupWindow && !popupWindow.isDestroyed()) popupWindow.hide();
}

export function getControlPopup(): BrowserWindow | null {
  return popupWindow && !popupWindow.isDestroyed() ? popupWindow : null;
}

export function destroyControlPopup(): void {
  markAppQuitting();
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }
  popupWindow = null;
}
