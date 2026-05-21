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

// Helper: move + pin the popup window's size. We use setBounds (not
// setPosition) and force width/height to POPUP_WIDTH/POPUP_HEIGHT
// every call because on Windows DWM, transparent frameless windows
// accumulate shadow-padding into their reported bounds on every move
// — over 60Hz of bubble-drag callbacks the popup balloons to 5×
// its real size (the v0.2.16-dev "popup expands when dragging" bug).
function moveAndPinPopup(x: number, y: number): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  popupWindow.setBounds({ x, y, width: POPUP_WIDTH, height: POPUP_HEIGHT });
}

// When the user drags the bubble, drag the panel along with it (only
// when the panel is currently visible AND in docked mode — undocked
// means the user explicitly placed the panel and doesn't want it
// snapping back). Subscribed once at module load; same callback for
// the life of the process.
onBubbleMove(() => {
  if (!popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible()) return;
  if (!panelDocked) return;
  const origin = topRightOrigin();
  moveAndPinPopup(origin.x, origin.y);
});

export function isPanelDocked(): boolean { return panelDocked; }
export function setPanelDocked(docked: boolean): void {
  panelDocked = docked;
  // If they just docked, snap the window under the bubble immediately so
  // there's visible feedback. If they just undocked, leave it where it is
  // and remember that position.
  if (docked && popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
    const origin = topRightOrigin();
    moveAndPinPopup(origin.x, origin.y);
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

  // Docked: figure out the best corner to "open from" so the popup
  // stays on-screen no matter where the user dragged the bubble. We
  // pick the quadrant of the bubble's screen position (top/bottom ×
  // left/right) and anchor the popup to the OPPOSITE corner of the
  // bubble so it always extends INTO the screen.
  const bubble = getBubbleBounds();
  const display = screen.getDisplayNearestPoint(
    bubble ? { x: bubble.x + bubble.width / 2, y: bubble.y + bubble.height / 2 } : { x: 0, y: 0 }
  );
  const { x: waX, y: waY, width: waW, height: waH } = display.workArea;

  if (!bubble) {
    // No bubble yet → fall back to top-right corner of work area.
    return {
      x: waX + waW - POPUP_WIDTH - SCREEN_EDGE_MARGIN,
      y: waY + SCREEN_EDGE_MARGIN,
    };
  }

  const bubbleMidX = bubble.x + bubble.width / 2;
  const bubbleMidY = bubble.y + bubble.height / 2;
  const screenMidX = waX + waW / 2;
  const screenMidY = waY + waH / 2;

  // Horizontal: bubble in right half → popup grows LEFT (anchor right
  // edge of popup to right edge of bubble). Bubble in left half →
  // popup grows RIGHT (anchor left edge of popup to left edge of
  // bubble).
  const isRightHalf = bubbleMidX >= screenMidX;
  const x = isRightHalf
    ? bubble.x + bubble.width - POPUP_WIDTH
    : bubble.x;

  // Vertical: bubble in bottom half → popup grows UP (anchor bottom
  // of popup to top of bubble). Bubble in top half → popup grows DOWN
  // (anchor top of popup to bottom of bubble). BUBBLE_GAP is the
  // breathing room between bubble and popup.
  const isBottomHalf = bubbleMidY >= screenMidY;
  const y = isBottomHalf
    ? bubble.y - POPUP_HEIGHT - BUBBLE_GAP
    : bubble.y + bubble.height + BUBBLE_GAP;

  // Final clamp: even after the quadrant flip, the popup might still
  // poke off-screen on narrow monitors. Pull it back inside the work
  // area with a SCREEN_EDGE_MARGIN buffer on each side.
  return {
    x: Math.max(waX + SCREEN_EDGE_MARGIN, Math.min(x, waX + waW - POPUP_WIDTH - SCREEN_EDGE_MARGIN)),
    y: Math.max(waY + SCREEN_EDGE_MARGIN, Math.min(y, waY + waH - POPUP_HEIGHT - SCREEN_EDGE_MARGIN)),
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
    moveAndPinPopup(origin.x, origin.y);
    // showInactive avoids stealing focus from whatever app the user was
    // working in — the whole point of a TipTour-style panel.
    win.showInactive();
  }
}

export function openControlPopup(): void {
  const win = ensurePopup();
  if (!win.isVisible()) {
    const origin = topRightOrigin();
    moveAndPinPopup(origin.x, origin.y);
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

// Mic-capture prep / release.
//
// macOS-specific issue: when the popup is at the screen-saver always-on-top
// level, the TCC microphone permission dialog can appear UNDERNEATH the
// popup the first time the user clicks mic — they never see it, mic
// silently fails. Lowering the popup's level to "floating" while a mic
// request is in flight lets the system dialog appear on top, then we
// restore screen-saver level so the popup stays above other apps for the
// rest of the session.
//
// Also: on Mac the popup is a `type: "panel"` (non-activating). Chromium's
// getUserMedia permission policy on some macOS versions requires the
// requesting window to be the focused webContents. We call
// `webContents.focus()` here too — focus is window-internal, doesn't
// activate the popup as a Mac app or steal focus from the underlying app.
export function prepareControlPopupForMic(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  try {
    popupWindow.setAlwaysOnTop(true, "floating");
  } catch { /* non-fatal — level swap not strictly required on Windows */ }
  try {
    // Mac NSPanel non-activating windows are SHOWN via showInactive(),
    // which means the window isn't the "key window" — and Chromium's
    // getUserMedia permission policy needs the requesting webContents
    // to live in the focused window of the focused app on Mac.
    //
    // BrowserWindow.focus() bridges to [NSWindow makeKeyAndOrderFront:]
    // on Mac which makes a non-activating NSPanel key WITHOUT
    // activating AIOS as the foreground app. webContents.focus() alone
    // doesn't bridge to that AppKit call — it only sets the renderer's
    // internal focus state, which isn't sufficient for TCC. We call
    // both here: BrowserWindow.focus() for the OS-level key state,
    // then webContents.focus() for the renderer.
    popupWindow.focus();
    popupWindow.webContents.focus();
  } catch { /* non-fatal */ }
}

export function releaseControlPopupAfterMic(): void {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  try {
    popupWindow.setAlwaysOnTop(true, "screen-saver");
  } catch { /* non-fatal */ }
}
