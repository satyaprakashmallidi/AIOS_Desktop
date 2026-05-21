// Computer Control bubble — a small always-on-top window that floats
// at the top-right of the user's primary display. Click toggles the
// popup panel; drag repositions the bubble (and the panel follows).
//
// Architecture:
//   - 56×56 transparent BrowserWindow, frameless, top-most. The visible
//     44px circle lives inside the renderer (BubbleApp.tsx) with a 6px
//     hover-bounce margin. The 56×56 window is just the click target.
//   - The bubble is the single drag handle for the whole Control surface.
//     Dragging the bubble drags the panel via the onBubbleMove
//     subscription (see control-popup.ts).
//   - Drag is owned ENTIRELY by main: when the renderer signals
//     pointerdown via the `control_bubble_drag_start` IPC, main starts
//     a ~60Hz polling loop using `screen.getCursorScreenPoint()` to
//     drive `setBounds`. This avoids the trap of relying on renderer
//     pointermove events, which stop firing the instant the cursor
//     leaves the 56px window (Electron's setPointerCapture doesn't
//     extend across window boundaries).
//   - Click vs drag is decided in the renderer at pointerup time by
//     measuring how far the cursor moved between down and up.
//
// Why not use `-webkit-app-region: drag`?
//   It eats click events on Electron 39+ (OS-native drag intercepts
//   the mouse before the webContents sees them).

import { BrowserWindow, screen } from "electron";
import * as path from "node:path";

const BUBBLE_SIZE = 56;          // outer window; visible circle is 44px
const SCREEN_EDGE_MARGIN = 16;
const DRAG_POLL_INTERVAL_MS = 16; // ~60Hz
// Diagnostic logging — writes to %TEMP%/aios-bubble-drag.log because
// console.log from Electron's main process on Windows isn't always
// captured by `concurrently` / Vite when launched via `npm run dev`.
// Flip to true if drag regressions appear in the wild.
const DRAG_DEBUG = false;
import * as fs from "node:fs";
import * as os from "node:os";
const DBG_LOG_PATH = path.join(os.tmpdir(), "aios-bubble-drag.log");
function dbg(...args: unknown[]) {
  if (!DRAG_DEBUG) return;
  const stamp = new Date().toISOString();
  const line = `${stamp} [bubble] ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}\n`;
  try {
    fs.appendFileSync(DBG_LOG_PATH, line);
  } catch {
    /* ignore */
  }
  // Also try console as a belt-and-braces measure.
  try { console.log("[bubble]", ...args); } catch { /* ignore */ }
}
// Truncate the log on startup so we don't grow forever and so each
// dev-session starts with a clean slate the user / agent can read top-to-bottom.
try { fs.writeFileSync(DBG_LOG_PATH, `=== aios bubble drag log @ ${new Date().toISOString()} ===\n`); } catch { /* ignore */ }

let bubbleWindow: BrowserWindow | null = null;
let onSubscribe: ((win: BrowserWindow) => void) | null = null;
let onUnsubscribe: ((win: BrowserWindow) => void) | null = null;
const moveListeners = new Set<() => void>();

export function onBubbleMove(cb: () => void): () => void {
  moveListeners.add(cb);
  return () => { moveListeners.delete(cb); };
}

function fireMoveListeners() {
  for (const cb of moveListeners) {
    try { cb(); } catch { /* one subscriber's failure shouldn't break others */ }
  }
}

export interface ControlBubbleHooks {
  subscribe: (win: BrowserWindow) => void;
  unsubscribe: (win: BrowserWindow) => void;
}

export function installControlBubbleHooks(hooks: ControlBubbleHooks): void {
  onSubscribe = hooks.subscribe;
  onUnsubscribe = hooks.unsubscribe;
}

function defaultBubbleOrigin(): { x: number; y: number } {
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
  const origin = defaultBubbleOrigin();
  const win = new BrowserWindow({
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    x: origin.x,
    y: origin.y,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: true,           // explicit: we need to be able to move it
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    // Disable Windows DWM frame/shadow that would draw a halo around
    // our transparent rounded bubble.
    thickFrame: false,
    roundedCorners: false,
    // Mac: NSPanel-style behavior (non-activating, stays above others).
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
  win.setAlwaysOnTop(true, "screen-saver");

  if (isMac) {
    try {
      (win as unknown as { setHiddenInMissionControl?: (h: boolean) => void })
        .setHiddenInMissionControl?.(true);
    } catch { /* non-fatal */ }
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(`${devUrl}?aios-control-bubble=1`);
  } else {
    win.loadFile(
      path.join(__dirname, "..", "renderer", "index.html"),
      { search: "aios-control-bubble=1" },
    );
  }

  win.on("close", (event) => {
    if (!bubbleQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // Native OS-initiated moves (rare for us since we own drag entirely,
  // but kept in case Electron decides to nudge the window via display
  // changes / DPI rescale). Notify panel anchor subscribers.
  win.on("moved", fireMoveListeners);

  win.on("closed", () => {
    if (onUnsubscribe && bubbleWindow) onUnsubscribe(bubbleWindow);
    bubbleWindow = null;
    endBubbleDrag();
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
    const origin = defaultBubbleOrigin();
    // Always force the explicit 56×56 size on show — Windows DWM
    // sometimes hands the BrowserWindow back at a different size
    // even though the constructor specified width:56/height:56,
    // and that wrong size then propagates through the drag loop.
    win.setBounds({ x: origin.x, y: origin.y, width: BUBBLE_SIZE, height: BUBBLE_SIZE });
    win.showInactive();
  }
}

export function hideControlBubble(): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.hide();
}

export function toggleControlBubble(): void {
  if (isBubbleVisible()) hideControlBubble();
  else showControlBubble();
}

export function destroyControlBubble(): void {
  markBubbleQuitting();
  endBubbleDrag();
  if (bubbleWindow && !bubbleWindow.isDestroyed()) bubbleWindow.destroy();
  bubbleWindow = null;
}

// ─── Drag implementation ──────────────────────────────────────────────
//
// We capture the cursor's offset from the bubble's top-left at drag
// start, then poll the cursor every 16ms and move the window so that
// offset is preserved. This means the bubble "sticks" to the cursor
// wherever it goes; it doesn't matter how fast the user moves because
// `screen.getCursorScreenPoint()` always returns the current desktop
// cursor location regardless of which window the cursor is over.

let dragOffset: { x: number; y: number } | null = null;
let dragInterval: ReturnType<typeof setInterval> | null = null;
let dragMoveCount = 0;

export function beginBubbleDrag(): void {
  if (!bubbleWindow || bubbleWindow.isDestroyed()) {
    dbg("beginBubbleDrag: no bubble window");
    return;
  }
  // Always cancel any previous drag before starting a new one. Defense
  // against rapid down-up-down sequences that drop the previous tick.
  endBubbleDrag();

  const pointer = screen.getCursorScreenPoint();
  const bounds = bubbleWindow.getBounds();
  dragOffset = {
    x: pointer.x - bounds.x,
    y: pointer.y - bounds.y,
  };
  dragMoveCount = 0;
  dbg("beginBubbleDrag", { pointer, bounds, offset: dragOffset });

  dragInterval = setInterval(() => {
    if (!bubbleWindow || bubbleWindow.isDestroyed() || !dragOffset) {
      dbg("tick: bailing", {
        hasWindow: !!bubbleWindow,
        destroyed: bubbleWindow?.isDestroyed(),
        offset: dragOffset,
      });
      endBubbleDrag();
      return;
    }
    const p = screen.getCursorScreenPoint();
    const nextX = Math.round(p.x - dragOffset.x);
    const nextY = Math.round(p.y - dragOffset.y);
    // Force size to BUBBLE_SIZE every tick. Reading `current.width` /
    // `current.height` and re-using them caused a fatal runaway: on
    // Windows, transparent/frameless windows have DWM-side padding
    // that getBounds reports but setBounds doesn't fully strip, so
    // each tick the reported size grew (56→652→688→716...). That
    // inflated invisible window also covered where the popup tried
    // to render, hiding it from the user. Hard-coding the size pins
    // the window to 56×56 forever.
    bubbleWindow.setBounds({
      x: nextX,
      y: nextY,
      width: BUBBLE_SIZE,
      height: BUBBLE_SIZE,
    });
    dragMoveCount++;
    if (DRAG_DEBUG && dragMoveCount % 30 === 0) {
      dbg("tick", { p, nextX, nextY, count: dragMoveCount });
    }
    fireMoveListeners();
  }, DRAG_POLL_INTERVAL_MS);
}

export function endBubbleDrag(): void {
  if (dragInterval) {
    dbg("endBubbleDrag", { ticksRun: dragMoveCount });
    clearInterval(dragInterval);
    dragInterval = null;
  }
  dragOffset = null;
  dragMoveCount = 0;
}

export function isBubbleDragging(): boolean {
  return dragInterval !== null;
}
