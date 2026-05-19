// Voice Control orchestration (v0.2.0+).
//
// Owns the action loop:
//   user transcript + system prompt + screen capture
//     -> Claude (with vision) ->
//   one action sentinel ([CLICK: ...], [TYPE: ...], etc.)
//     -> sidecar/python executes ->
//   loop with fresh screenshot until [DONE] or abort or MAX_TURNS.
//
// On Windows this uses the Python sidecar's pyautogui IPCs. On Mac, the same
// IPCs work as a fallback; the eventual Swift sidecar (Phase 1 of the plan)
// will be a drop-in replacement that adds AX-tree grounding and CGEvent
// reliability — same JSON-RPC interface, no orchestration changes needed.

import type { BrowserWindow } from "electron";
import type { PythonHost } from "./python-host";
import { log } from "./logger";

const DEFAULT_MAX_TURNS = 16;
const ABSOLUTE_MAX_TURNS = 32;
const CONTINUE_GRANT = 8;
const POST_ACTION_SETTLE_MS = 120;
// OPEN / DRAG / SCROLL / CLIPBOARD actions need more settle time than a
// raw CLICK or TYPE — apps need to draw, scroll positions to land,
// clipboard ops to register. Tuned per-action below.
const POST_OPEN_SETTLE_MS = 1000;
const POST_DRAG_SETTLE_MS = 250;

// Bounds of an AX element, used to resolve [CLICK: target_id=N] to coords.
interface AxElement {
  id: number;
  name: string;
  control_type: string;
  bounds: { x: number; y: number; w: number; h: number };
  clickable: boolean;
}

export type VoiceState =
  | { kind: "idle" }
  | { kind: "thinking"; turn: number }
  | { kind: "executing"; turn: number; action: ParsedAction; rationale?: string }
  | { kind: "done"; summary: string }
  | { kind: "blocked"; reason: string }
  | { kind: "aborted" }
  | { kind: "error"; message: string };

export type ActionType =
  | "CLICK"
  | "TYPE"
  | "HOTKEY"
  | "SCROLL"
  | "OPEN"
  | "MOVE"
  | "DRAG"
  | "CLIPBOARD_GET"
  | "CLIPBOARD_SET"
  | "WAIT"
  | "CONTINUE"
  | "DONE"
  | "BLOCKED";

export interface ParsedAction {
  type: ActionType;
  args: Record<string, string>;
}

const SYSTEM_PROMPT = `You are AIOS's Voice Control agent on the user's computer.

Each turn you receive:
- their spoken intent (transcript) and the current turn number
- a file path to a fresh screenshot — use the Read tool on it BEFORE deciding
  what to do so you can see the actual screen (Sonnet has vision)
- when available, a SUMMARY of the focused window's accessibility tree:
  numbered elements with their type, label, and bounds. Format:
    [14] ButtonControl "Submit" @ 480,320 200x40
  When the tree is non-empty, PREFER targeting elements by id over guessing
  pixel coords — it's much more reliable. Use [CLICK: target_id=14] instead
  of [CLICK: x=580, y=340]. Coords still work as a fallback.
- short notes about any actions you took earlier this run (and the result
  for things like CLIPBOARD_GET)

Pick exactly ONE action per turn, then stop. AIOS executes it, takes a new
screenshot, and calls you back. Most tasks need 1-5 turns. You start with
up to 16 turns; emit [CONTINUE: reason="..."] if you need more (granted in
chunks of 8, hard cap 32).

When the user names an app, use proper title casing: "Spotify", "Chrome",
"Visual Studio Code" — not lowercase. The launcher is case-insensitive but
correct names produce cleaner action logs and clearer reasoning.

End your reply with EXACTLY ONE sentinel on its own line. Use double-quotes
around string values. Available actions:

  [OPEN: target="notepad"]
    Launch an app, file, or URL via the OS shell. PREFERRED for any
    "open the X app" intent. Works for installed apps (notepad, chrome,
    spotify, discord, code), URLs (https://...), file paths, and protocols
    (mailto:..., ms-settings:display on Win). Single turn — no need to
    drive Win+R / Spotlight manually.

  [CLICK: target_id=14, label="Submit button"]
    PREFERRED form when the AX tree summary above lists the target. AIOS
    looks up element #14's bounds and clicks its center. More reliable
    than coords for any structured app.

  [CLICK: x=NUM, y=NUM, label="what you're clicking", button="left", clicks=1]
    Fallback: click at pixel coords. button can be "left" / "right" /
    "middle". clicks=2 for double-click. Coords are top-left origin, in
    physical screen pixels.

  [TYPE: text="hello world", clear=true]
    Type into the focused field. clear=true does Ctrl+A + Delete FIRST,
    so the new text replaces whatever was there. ALWAYS use clear=true for
    address bars, search boxes, Run dialogs — they often have residual text.

  [HOTKEY: keys="ctrl+shift+t"]
    Press a keyboard shortcut. Combine with "+". Use ctrl/alt/shift/win
    on Windows; cmd/option/ctrl/shift on Mac. Single keys also work:
    keys="enter", "escape", "tab", "f5", "backspace", etc.

  [SCROLL: dy=NUM]
    Mouse wheel scroll. Positive = up, negative = down. Try ~300 for one
    notch.

  [MOVE: x=NUM, y=NUM, duration=0.2]
    Move cursor without clicking (e.g. to reveal hover-only menus).

  [DRAG: x1=NUM, y1=NUM, x2=NUM, y2=NUM, button="left", duration=0.35]
    Drag from one point to another. Used for window resize, slider
    drags, text selection by drag, drag-and-drop.

  [CLIPBOARD_SET: text="long content here"]
    Set the system clipboard. Then a [HOTKEY: keys="ctrl+v"] (or cmd+v
    on Mac) pastes it — way faster than TYPE for big text.

  [CLIPBOARD_GET]
    Read the current clipboard text. Result appears in the next turn's
    action notes so you can use it.

  [WAIT: seconds=1.5]
    Pause for the UI to settle (after launching an app, after a page
    nav, etc). Capped at 5 seconds per call.

  [CONTINUE: reason="halfway through, need more turns"]
    Grants 8 more turns when you're approaching the cap. Only use if you
    genuinely need them. Hard cap at 32 total turns.

  [DONE: short summary of what you accomplished]
  [BLOCKED: explain what's unclear or what needs user input]

PLATFORM TIPS:

Windows examples:
- Open File Explorer in a folder:   [OPEN: target="C:\\Users\\me\\Downloads"]
- Open Settings:                    [OPEN: target="ms-settings:"]
- Take a screenshot (Snip & Sketch): [HOTKEY: keys="win+shift+s"]
- Open Run dialog:                  [HOTKEY: keys="win+r"]
- Switch app:                       [HOTKEY: keys="alt+tab"]
- Show desktop:                     [HOTKEY: keys="win+d"]
- Lock screen:                      [HOTKEY: keys="win+l"]
- Snap window to half:              [HOTKEY: keys="win+left"] or "win+right"

Mac examples:
- Open Spotlight:                   [HOTKEY: keys="cmd+space"]
- Switch app:                       [HOTKEY: keys="cmd+tab"]
- Take a screenshot:                [HOTKEY: keys="cmd+shift+5"]
- Open a Mac app by bundle id:      [OPEN: target="com.apple.notes"]
- Mission Control:                  [HOTKEY: keys="ctrl+up"]
- Hide front app:                   [HOTKEY: keys="cmd+h"]

DEFINE SUCCESS UPFRONT (turn 1 only):

On your VERY FIRST turn, before doing anything, state a single sentence
called the SUCCESS CRITERION — the specific visible thing(s) that will
prove the user's request was completed. Format it like this on its own line:

  SUCCESS_CRITERION: <one specific, falsifiable visible-on-screen condition>

Examples (NOT a closed list — derive your own from the user's actual ask):
  • User asks "open Spotify and play Telugu music" →
    SUCCESS_CRITERION: A Telugu song is actively playing — pause icon (‖)
    is visible in the player bar AND the track time is counting up.
  • User asks "write a haiku in Notepad and save it as poem.txt on Desktop" →
    SUCCESS_CRITERION: Notepad shows a 3-line haiku in the editor AND the
    title bar reads "poem.txt - Notepad" (no asterisk meaning saved).
  • User asks "show me the weather in Paris" →
    SUCCESS_CRITERION: A weather panel or webpage is visible showing
    Paris with a current temperature.
  • User asks "send a message to my friend John saying I'm running late" →
    SUCCESS_CRITERION: The message "I'm running late" appears in John's
    chat thread as a sent message (right-aligned, with a sent indicator).

Rules for writing a good criterion:
  - It must be VISIBLE on a screenshot — no audible-only, no off-screen,
    no "the action was triggered" (that's not visible proof).
  - It must be SPECIFIC enough that a stranger could check your screenshot
    and say yes/no without ambiguity.
  - It must DIRECTLY reflect the user's intent — don't soften it
    ("Spotify is open" is NOT enough if the user said "play music").
  - If the request is multi-part, COMBINE the conditions with AND.
  - If the request CAN'T be visually verified (audio-only, off-screen
    result, no UI feedback), say so up-front and emit [BLOCKED: ...] in
    turn 1 — don't try to fake it.

Carry this criterion mentally through every turn. Every time you consider
a sentinel, ask: "Does the screen now match the criterion?" If yes →
[DONE]. If no → another action moving toward it.

THINK BEFORE YOU ACT (mandatory, every turn after turn 1):

  1. WHAT IS THE GOAL of this single turn? (a sub-step toward the criterion)

  2. WHAT'S THE MOST RELIABLE WAY for THIS app/context?
     Pixel-clicking is the LAST resort. Before [CLICK], ask:
       a. Keyboard shortcut? Almost every modern app exposes them:
          Ctrl+L / Ctrl+K for address/search bars in browsers, Spotify,
          Slack, Discord, VS Code. Ctrl+F to find. Ctrl+T new tab.
          Ctrl+Shift+P command palette. F2 rename. Alt+Tab / Cmd+Tab
          switch app. Win+E File Explorer. Cmd+Space Spotlight. If you
          know one, USE IT — vastly more reliable than guessing coords.
       b. OS-level command? [OPEN: target="..."] for apps, URLs
          (https://...), file paths, protocols (ms-settings:display).
          One turn beats four turns of click-typing.
       c. Is the target in the ACCESSIBILITY TREE above? Use
          [CLICK: target_id=NUM] — never wrong about coords.
       d. ONLY if a/b/c don't apply, fall back to [CLICK: x=, y=].

  3. WHAT DO I EXPECT TO SEE AFTER this action? State it out loud.
     Next turn, compare expectation vs reality. Mismatch = try something
     different, don't repeat.

HOVER-REVEAL UIs (important — common failure mode):

Many modern apps hide buttons until you hover over their parent row. The
button only renders when the cursor is over the container. Pixel-clicking
fixed coords where you THINK the button should be will miss every time
because the button doesn't exist on screen yet.

Common offenders: Spotify playlist rows, YouTube video tiles, GitHub PR
rows, Linear issue rows, Gmail message rows, file managers' row actions,
any "card" list with hover-only action buttons.

Pattern to use:
  Turn N:    [MOVE: x=ROW_CENTER_X, y=ROW_CENTER_Y]   ← hover over the row
  Turn N+1:  [CLICK: x=PLAY_BUTTON_X, y=PLAY_BUTTON_Y, label="..."]
             ← now the button is visible; click its actual coords

After [MOVE], take the next screenshot before clicking — the hover-revealed
button may appear in a different position than you expected.

Even better when the AX tree exposes the row: [CLICK: target_id=N] usually
resolves to the row's center and triggers default activation (Spotify
clicks-on-row often work this way).

If two click attempts at similar coords don't move toward the criterion,
the button you're aiming at probably doesn't exist on screen yet — try
MOVE first.

RULES (after thinking):
- ALWAYS Read the screenshot path BEFORE acting. The screen changes every
  turn — don't trust your memory.
- AIOS auto-brings a newly-OPENed app to the foreground; you usually do NOT
  need to click its taskbar icon afterwards.
- For LONG text input (paragraphs, code, URLs, addresses), use
  [CLIPBOARD_SET: text="..."] + [HOTKEY: keys="ctrl+v"] instead of TYPE —
  faster and avoids autocomplete eating your input.
- Coords are PIXELS in physical screen space, top-left = (0,0).
- If the screen is ambiguous, target is hidden, OS prompts for a permission,
  or you'd need to do something irreversible (delete, send, payment,
  broad-impact setting change), emit [BLOCKED: ...] with the reason — never
  act silently on a guess.
- If a prior action didn't have the expected effect (screen looks the same
  or wrong), describe what you actually see and try a DIFFERENT approach.
  Do NOT repeat the same click coords or same HOTKEY in consecutive turns
  — if it didn't work once, it won't work again. Change your approach:
  try a different element, a keyboard shortcut, or [BLOCKED] if stuck.

VERIFY BEFORE DONE (universal, every task):

Step A — Settle. Before emitting [DONE], if your previous action triggered
a state change (anything that's not a pure read — click, type, hotkey,
open, drag, scroll), insert one [WAIT: seconds=2] turn first so the UI
catches up. The next screenshot then reflects the actual result, not the
mid-action frame.

Step B — Compare the screen to YOUR criterion. The SUCCESS_CRITERION you
declared on turn 1 is the rubric. Quote it back, then read the latest
screenshot and answer:
  - "Does the screen match the criterion right now? Point at the specific
    pixels/regions that prove it. If you can't point at them, the answer
    is no."

Step C — Decide.
  • If screen fully matches criterion → emit [DONE: one-sentence summary
    that names the visible evidence].
  • If screen partially matches → keep going; don't declare DONE on a
    partial match.
  • If screen doesn't match AND further action could fix it → try a
    different approach (not the same action that just failed).
  • If screen doesn't match AND you can't see how to fix it → emit
    [BLOCKED: what's still missing relative to the criterion].

NEVER claim evidence you can't see. NEVER soften the criterion just to
escape the loop. "It should be playing", "I think it worked", "the action
was triggered" are NEVER acceptable — they're predictions, not observations.

A false [DONE] is the worst possible outcome — worse than running out of
turns. When in doubt, emit [BLOCKED: ...] with what you can't confirm.

A stricter verifier will independently check your [DONE] against a fresh
screenshot. If you declared DONE prematurely the verifier will reject it.`;

interface VoiceRun {
  abort: AbortController;
  promise: Promise<unknown>;
}

let activeRun: VoiceRun | null = null;
let lastState: VoiceState = { kind: "idle" };

export function getVoiceState(): VoiceState {
  return lastState;
}

export function isVoiceRunning(): boolean {
  return activeRun !== null;
}

export async function abortVoiceLoop(broadcastWindow?: BrowserWindow | null): Promise<void> {
  if (!activeRun) return;
  activeRun.abort.abort();
  try {
    await activeRun.promise;
  } catch {
    /* swallow */
  }
  activeRun = null;
  publishState({ kind: "aborted" }, broadcastWindow);
}

export interface StartVoiceLoopArgs {
  transcript: string;
  claudePath: string;
  host: PythonHost;
  mainWindow: BrowserWindow | null;
  maxTurns?: number;
}

export async function startVoiceLoop({ transcript, claudePath, host, mainWindow, maxTurns }: StartVoiceLoopArgs): Promise<{ ok: boolean; reason?: string; summary?: string }> {
  if (activeRun) {
    await abortVoiceLoop(mainWindow);
  }
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_transcript" };
  }
  if (!claudePath) {
    return { ok: false, reason: "claude_not_configured" };
  }

  const abort = new AbortController();
  const promise = runLoop({
    transcript: trimmed,
    claudePath,
    host,
    mainWindow,
    signal: abort.signal,
    initialMaxTurns: Math.max(1, Math.min(ABSOLUTE_MAX_TURNS, maxTurns ?? DEFAULT_MAX_TURNS))
  });
  activeRun = { abort, promise };

  try {
    const result = await promise;
    return result;
  } finally {
    if (activeRun?.abort === abort) activeRun = null;
  }
}

async function runLoop({
  transcript,
  claudePath,
  host,
  mainWindow,
  signal,
  initialMaxTurns
}: {
  transcript: string;
  claudePath: string;
  host: PythonHost;
  mainWindow: BrowserWindow | null;
  signal: AbortSignal;
  initialMaxTurns: number;
}): Promise<{ ok: boolean; reason?: string; summary?: string }> {
  const actionLog: string[] = [];
  let turn = 0;
  let maxTurns = initialMaxTurns;
  // Last fetched AX tree — used to resolve [CLICK: target_id=N] without
  // re-walking. Refreshed every turn so target_ids are always current.
  let axElements: AxElement[] = [];
  // Repeat detection. If Claude emits the same effective action two turns
  // in a row, inject a warning into the next prompt. On a third repeat,
  // abort the loop — that's a stuck-thrash and continuing wastes turns.
  let lastFingerprint: string | null = null;
  let consecutiveDuplicates = 0;
  let duplicateWarning: string | null = null;

  while (turn < maxTurns) {
    if (signal.aborted) return { ok: false, reason: "aborted" };
    turn += 1;

    publishState({ kind: "thinking", turn }, mainWindow);

    // Fetch screen + AX tree in parallel — neither needs the other's result,
    // and waiting serially adds ~1.5s per turn for nothing.
    let screenshotB64: string;
    let axSummary = "";
    try {
      const [screen, ax] = await Promise.all([
        host.invoke<{ png: string; width: number; height: number }>("screen_capture", { monitor: "active" }),
        host.invoke<{ available: boolean; elements: AxElement[]; truncated?: boolean; foreground?: string; count?: number }>("screen_ax_tree", { maxElements: 120, timeBudget: 1.5 }),
      ]);
      if (!screen.ok || !screen.data) throw new Error(screen.error?.message ?? "screen_capture failed");
      screenshotB64 = screen.data.png;
      if (ax.ok && ax.data?.available && Array.isArray(ax.data.elements)) {
        axElements = ax.data.elements;
        axSummary = summariseAxTree(ax.data.elements, ax.data.foreground, ax.data.truncated);
      } else {
        axElements = [];
        axSummary = "";
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      publishState({ kind: "error", message: `Couldn't capture screen: ${message}` }, mainWindow);
      return { ok: false, reason: "screen_capture_failed" };
    }

    if (signal.aborted) return { ok: false, reason: "aborted" };

    const prompt = buildTurnPrompt({ transcript, actionLog, turn, maxTurns, axSummary, duplicateWarning });
    duplicateWarning = null; // consume it — only inject once per repeat
    let claudeReply: string;
    try {
      const res = await host.invoke<{ response: string }>("run_task", {
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        claudePath,
        model: "sonnet",
        imagesBase64: [screenshotB64]
      }, 120_000);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Claude call failed");
      claudeReply = String(res.data.response || "").trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      publishState({ kind: "error", message: `Claude error: ${message}` }, mainWindow);
      return { ok: false, reason: "claude_failed" };
    }

    if (signal.aborted) return { ok: false, reason: "aborted" };

    const action = parseFirstSentinel(claudeReply);
    log("voice", "claude reply", { turn, action, replyHead: claudeReply.slice(0, 200) });

    if (!action) {
      publishState({ kind: "error", message: "Claude didn't emit an action — try a clearer command." }, mainWindow);
      return { ok: false, reason: "no_action" };
    }

    if (action.type === "DONE") {
      const summary = action.args.summary || claudeReply.replace(/\[DONE:[\s\S]*$/m, "").trim();
      // Verification pass: Claude has been over-eager about declaring DONE
      // when the actual outcome (music playing, file saved, etc.) hasn't
      // happened. Take a fresh screenshot 1.5s later and run a strict
      // verify call. If the verifier rejects, convert to BLOCKED instead
      // of accepting a false DONE.
      publishState({ kind: "thinking", turn }, mainWindow);
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const verifyScreen = await host.invoke<{ png: string }>("screen_capture", { monitor: "active" });
        if (verifyScreen.ok && verifyScreen.data) {
          const verifyPrompt = [
            `The voice-control agent just claimed the user's task is COMPLETE.`,
            ``,
            `USER ASKED: "${transcript}"`,
            `AGENT'S CLAIMED SUMMARY: "${summary}"`,
            ``,
            `Your job is to be the second pair of eyes. Independently:`,
            ``,
            `1. From the user's request alone, write the SUCCESS_CRITERION —`,
            `   the specific, falsifiable, visible-on-screen thing(s) that`,
            `   must be true for this task to genuinely be done. Be strict:`,
            `   the criterion must match the user's actual intent, not a`,
            `   weaker proxy. (e.g. "play music" requires audible playback`,
            `   confirmed by a pause icon or counting-up time, NOT just an`,
            `   open Spotify window.)`,
            ``,
            `2. Look at the attached fresh screenshot (taken 1.5s after the`,
            `   agent's last action).`,
            ``,
            `3. Compare. Does the screen RIGHT NOW satisfy every part of`,
            `   your criterion? Point to the specific visible evidence`,
            `   (or the specific thing that's missing).`,
            ``,
            `Reject if uncertain. A false-positive (verifying when it's not`,
            `actually done) is much worse than a false-negative.`,
            ``,
            `End your reply with EXACTLY ONE of these on its own final line:`,
            `  [VERIFIED: 1-sentence citation of the visible evidence]`,
            `  [NOT_VERIFIED: what's missing — what you'd need to see for done]`
          ].join("\n");
          const verifyRes = await host.invoke<{ response: string }>("run_task", {
            prompt: verifyPrompt,
            systemPrompt:
              "You are an independent verifier for an OS-control agent. You receive the user's original request, the agent's summary of what it claims to have done, and a fresh screenshot. Derive the success criterion from the user's REQUEST (not the agent's summary — the summary may be wrong). Then check the screenshot against that criterion strictly. When in doubt, reject. A false [VERIFIED] is the worst outcome you can produce.",
            claudePath,
            model: "sonnet",
            imagesBase64: [verifyScreen.data.png]
          }, 60_000);
          const reply = (verifyRes.ok && verifyRes.data?.response) || "";
          const verifiedMatch = reply.match(/\[VERIFIED:\s*([\s\S]*?)\]/);
          const notVerifiedMatch = reply.match(/\[NOT_VERIFIED:\s*([\s\S]*?)\]/);
          if (notVerifiedMatch && !verifiedMatch) {
            const why = notVerifiedMatch[1].trim();
            publishState({
              kind: "blocked",
              reason: `Claimed done, but verification failed: ${why}`
            }, mainWindow);
            return { ok: false, reason: "not_verified", summary: why };
          }
          // VERIFIED (or ambiguous reply) — accept the DONE.
        }
      } catch (err) {
        log("voice", "verification failed (accepting DONE anyway)", { error: err instanceof Error ? err.message : String(err) });
        // If verification itself errors, fall through to accepting DONE
        // rather than blocking on infrastructure issues.
      }
      publishState({ kind: "done", summary }, mainWindow);
      return { ok: true, summary };
    }

    if (action.type === "BLOCKED") {
      const reason = action.args.reason || claudeReply.replace(/\[BLOCKED:[\s\S]*$/m, "").trim();
      publishState({ kind: "blocked", reason }, mainWindow);
      return { ok: false, reason: "blocked", summary: reason };
    }

    if (action.type === "CONTINUE") {
      const reason = action.args.reason || "more turns requested";
      const newMax = Math.min(ABSOLUTE_MAX_TURNS, maxTurns + CONTINUE_GRANT);
      const granted = newMax - maxTurns;
      maxTurns = newMax;
      actionLog.push(`CONTINUE — granted ${granted} more turns (now ${maxTurns} max). Reason: ${reason}`);
      // No action to execute; loop back to next turn so Claude can keep going.
      continue;
    }

    // Repeat-action detection. Fingerprint normalizes: CLICK coords are
    // bucketed to 40-pixel cells (so 81,197 and 82,196 hash the same), TYPE
    // uses the text, HOTKEY uses the keys, etc. Identical fingerprint
    // across consecutive turns = Claude is thrashing.
    const fingerprint = actionFingerprint(action);
    if (fingerprint && fingerprint === lastFingerprint) {
      consecutiveDuplicates += 1;
      if (consecutiveDuplicates >= 2) {
        // Third identical action in a row — abort. Claude is stuck and
        // burning turns. The user can re-issue with a different phrasing.
        publishState({
          kind: "blocked",
          reason: `Stopped after the same action [${action.type}] was tried 3 times in a row without progress. The current approach isn't working — try restating your request more specifically.`
        }, mainWindow);
        return { ok: false, reason: "duplicate_loop" };
      }
      // Second identical — warn Claude in the NEXT prompt so it changes tack.
      duplicateWarning =
        `WARNING: you just emitted [${action.type}] with effectively the same arguments as the previous turn. ` +
        `That suggests the action isn't having the expected effect. After this turn, if the screen still hasn't changed, DO NOT repeat — try a different approach: ` +
        `a keyboard shortcut, a different target, a WAIT, or [BLOCKED] if stuck. One more identical action and the loop will abort.`;
    } else {
      consecutiveDuplicates = 0;
    }
    lastFingerprint = fingerprint;

    const rationale = claudeReply.replace(/\[[A-Z_]+:[\s\S]*?\]\s*$/m, "").trim();
    publishState({ kind: "executing", turn, action, rationale }, mainWindow);

    let actionNote: string | undefined;
    try {
      const result = await executeAction(host, action, axElements);
      actionNote = result.note;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      publishState({ kind: "error", message: `Action failed: ${message}` }, mainWindow);
      return { ok: false, reason: "action_failed" };
    }

    // Per-action settle: OPEN needs ~1s for the new app to draw before
    // the next screenshot, otherwise Claude sees a stale frame and burns
    // a turn. DRAG needs a bit. Everything else gets the default.
    const settle =
      action.type === "OPEN" ? POST_OPEN_SETTLE_MS
      : action.type === "DRAG" ? POST_DRAG_SETTLE_MS
      : POST_ACTION_SETTLE_MS;
    await new Promise((r) => setTimeout(r, settle));
    const summary = describeAction(action, axElements);
    actionLog.push(actionNote ? `${summary} — ${actionNote}` : summary);
  }

  publishState({ kind: "error", message: `Stopped after ${maxTurns} turns.` }, mainWindow);
  return { ok: false, reason: "max_turns" };
}

function summariseAxTree(elements: AxElement[], foreground: string | undefined, truncated: boolean | undefined): string {
  if (!elements.length) return "";
  // Sort by area descending so the most prominent elements come first; cap
  // at 40 to keep the prompt size manageable.
  const sorted = [...elements].sort((a, b) => (b.bounds.w * b.bounds.h) - (a.bounds.w * a.bounds.h));
  const top = sorted.slice(0, 40);
  const lines = top.map((e) => {
    const nm = e.name ? ` "${e.name.slice(0, 80)}"` : "";
    return `  [${e.id}] ${e.control_type}${nm} @ ${e.bounds.x},${e.bounds.y} ${e.bounds.w}x${e.bounds.h}`;
  });
  const header = `ACCESSIBILITY TREE (focused window: ${foreground || "?"}${truncated ? ", truncated" : ""}, ${elements.length} total):`;
  return [header, ...lines].join("\n");
}

async function executeAction(host: PythonHost, action: ParsedAction, axElements: AxElement[]): Promise<{ note?: string }> {
  switch (action.type) {
    case "CLICK": {
      let x: number;
      let y: number;
      // Prefer target_id resolution when Claude used the AX tree — much more
      // accurate than pixel guessing.
      const targetIdRaw = action.args.target_id ?? action.args.targetId;
      if (targetIdRaw !== undefined && targetIdRaw !== "") {
        const id = Number(targetIdRaw);
        const el = axElements.find((e) => e.id === id);
        if (!el) {
          throw new Error(`CLICK target_id=${id} not found in current AX tree (${axElements.length} elements available)`);
        }
        x = Math.round(el.bounds.x + el.bounds.w / 2);
        y = Math.round(el.bounds.y + el.bounds.h / 2);
      } else {
        x = Number(action.args.x);
        y = Number(action.args.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          throw new Error(`CLICK needs target_id OR numeric x/y; got x=${action.args.x}, y=${action.args.y}`);
        }
      }
      const button = (action.args.button || "left").toLowerCase();
      const clicks = Math.max(1, Math.min(3, Number(action.args.clicks) || 1));
      const res = await host.invoke("voice_click", { x, y, button, clicks });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "TYPE": {
      const text = action.args.text ?? "";
      const clear = /^(true|1|yes)$/i.test(action.args.clear ?? "");
      const res = await host.invoke("voice_type", { text, clear });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "HOTKEY": {
      const keys = action.args.keys ?? "";
      const res = await host.invoke("voice_hotkey", { keys });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "SCROLL": {
      const dy = Number(action.args.dy);
      if (!Number.isFinite(dy)) throw new Error(`SCROLL needs numeric dy; got dy=${action.args.dy}`);
      const res = await host.invoke("voice_scroll", { dy });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "OPEN": {
      const target = action.args.target ?? action.args.app ?? "";
      if (!target) throw new Error(`OPEN needs a target= value`);
      const res = await host.invoke("voice_open", { target });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "MOVE": {
      const x = Number(action.args.x);
      const y = Number(action.args.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`MOVE needs numeric x and y`);
      }
      const duration = Number(action.args.duration) || 0.2;
      const res = await host.invoke("voice_move", { x, y, duration });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "DRAG": {
      const x1 = Number(action.args.x1);
      const y1 = Number(action.args.y1);
      const x2 = Number(action.args.x2);
      const y2 = Number(action.args.y2);
      if (![x1, y1, x2, y2].every(Number.isFinite)) {
        throw new Error(`DRAG needs numeric x1, y1, x2, y2`);
      }
      const button = (action.args.button || "left").toLowerCase();
      const duration = Number(action.args.duration) || 0.35;
      const res = await host.invoke("voice_drag", { x1, y1, x2, y2, button, duration });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "CLIPBOARD_SET": {
      const text = action.args.text ?? "";
      const res = await host.invoke("voice_clipboard_set", { text });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    case "CLIPBOARD_GET": {
      const res = await host.invoke<{ text: string }>("voice_clipboard_get", {});
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "clipboard_get failed");
      const text = res.data.text || "";
      const preview = text.length > 200 ? text.slice(0, 200) + "…" : text;
      // Feed the clipboard contents back into next turn's user prompt.
      return { note: `clipboard now contains: """${preview}"""` };
    }
    case "WAIT": {
      const seconds = Number(action.args.seconds);
      const s = Number.isFinite(seconds) ? seconds : 1;
      const res = await host.invoke("voice_wait", { seconds: s });
      if (!res.ok) throw new Error(res.error?.message);
      return {};
    }
    default:
      throw new Error(`Unhandled action type: ${action.type}`);
  }
}

function buildTurnPrompt({ transcript, actionLog, turn, maxTurns, axSummary, duplicateWarning }: { transcript: string; actionLog: string[]; turn: number; maxTurns: number; axSummary: string; duplicateWarning?: string | null }): string {
  const parts: string[] = [
    `User said: "${transcript}"`,
    `Turn ${turn} of ${maxTurns}.`,
  ];
  if (duplicateWarning) {
    parts.push("");
    parts.push("⚠ " + duplicateWarning);
    parts.push("");
  }
  if (actionLog.length > 0) {
    parts.push("Actions you've taken so far this run:");
    actionLog.forEach((line, i) => parts.push(`  ${i + 1}. ${line}`));
    parts.push("");
  }
  if (axSummary) {
    parts.push(axSummary);
    parts.push("");
    parts.push("Prefer [CLICK: target_id=N] over pixel coords when an element above matches your target.");
  } else {
    parts.push("(No accessibility tree available for this app — rely on the screenshot for pixel coords.)");
  }
  parts.push("");
  parts.push("Look at the attached screenshot, then pick the next single action and end your reply with one sentinel.");
  return parts.join("\n");
}

// Normalize an action to a fingerprint string. Two actions hash to the same
// fingerprint when they're "effectively the same" — clicks within 40 pixels
// of each other count as identical (so 81,197 and 82,196 collapse).
function actionFingerprint(action: ParsedAction): string | null {
  switch (action.type) {
    case "CLICK": {
      const tid = action.args.target_id ?? action.args.targetId;
      if (tid !== undefined && tid !== "") return `CLICK:target_id=${tid}`;
      const bx = Math.round(Number(action.args.x) / 40);
      const by = Math.round(Number(action.args.y) / 40);
      const btn = (action.args.button || "left").toLowerCase();
      const clicks = action.args.clicks || "1";
      return `CLICK:${bx},${by},${btn},${clicks}`;
    }
    case "TYPE":
      return `TYPE:${(action.args.text || "").slice(0, 80)}`;
    case "HOTKEY":
      return `HOTKEY:${(action.args.keys || "").toLowerCase()}`;
    case "SCROLL":
      return `SCROLL:${Math.sign(Number(action.args.dy) || 0)}`;
    case "OPEN":
      return `OPEN:${(action.args.target || action.args.app || "").toLowerCase()}`;
    case "MOVE":
    case "DRAG":
    case "CLIPBOARD_GET":
    case "CLIPBOARD_SET":
    case "WAIT":
    case "CONTINUE":
      return null; // don't dedupe these — usually legitimately repeated
    default:
      return null;
  }
}

function describeAction(action: ParsedAction, axElements: AxElement[] = []): string {
  switch (action.type) {
    case "CLICK": {
      const button = (action.args.button || "left").toLowerCase();
      const clicks = Number(action.args.clicks) || 1;
      const verb = clicks >= 2 ? "DOUBLE-CLICK" : button === "right" ? "RIGHT-CLICK" : "CLICK";
      const targetId = action.args.target_id ?? action.args.targetId;
      if (targetId !== undefined && targetId !== "") {
        const el = axElements.find((e) => e.id === Number(targetId));
        const labelStr = action.args.label ? ` (${action.args.label})` : el?.name ? ` (${el.name})` : "";
        return `${verb} target_id=${targetId}${labelStr}`;
      }
      return `${verb} ${action.args.x},${action.args.y}${action.args.label ? ` (${action.args.label})` : ""}`;
    }
    case "CONTINUE":
      return `CONTINUE (${action.args.reason || "more turns"})`;
    case "TYPE":
      return `TYPE${action.args.clear ? " (cleared)" : ""} "${(action.args.text ?? "").slice(0, 60)}"`;
    case "HOTKEY":
      return `HOTKEY ${action.args.keys}`;
    case "SCROLL":
      return `SCROLL ${action.args.dy}`;
    case "OPEN":
      return `OPEN ${action.args.target ?? action.args.app}`;
    case "MOVE":
      return `MOVE ${action.args.x},${action.args.y}`;
    case "DRAG":
      return `DRAG ${action.args.x1},${action.args.y1} → ${action.args.x2},${action.args.y2}`;
    case "CLIPBOARD_SET":
      return `CLIPBOARD_SET "${(action.args.text ?? "").slice(0, 40)}…"`;
    case "CLIPBOARD_GET":
      return `CLIPBOARD_GET`;
    case "WAIT":
      return `WAIT ${action.args.seconds}s`;
    default:
      return action.type;
  }
}

// ─── Sentinel parser ─────────────────────────────────────────────────────────
// Tolerant of whitespace and order. Takes the LAST sentinel in the reply (so
// chain-of-thought text earlier doesn't get parsed as the action). Kwarg
// values may be bare or double-quoted; double-quoted preserves commas inside
// the value, which matters for [TYPE: text="hello, world"].

const SENTINEL_RE = /\[(CLICK|TYPE|HOTKEY|SCROLL|OPEN|MOVE|DRAG|CLIPBOARD_GET|CLIPBOARD_SET|WAIT|CONTINUE|DONE|BLOCKED):\s*([\s\S]*?)\]/g;

export function parseFirstSentinel(text: string): ParsedAction | null {
  const matches = [...text.matchAll(SENTINEL_RE)];
  if (matches.length === 0) return null;
  const m = matches[matches.length - 1];
  const type = m[1].toUpperCase() as ActionType;
  const body = m[2].trim();
  return { type, args: parseKwargs(body, type) };
}

function parseKwargs(body: string, type: ActionType): Record<string, string> {
  // DONE / BLOCKED / CONTINUE — entire body is the message; no key=value parsing.
  if (type === "DONE") return { summary: body.replace(/^summary\s*=\s*/, "").trim().replace(/^"|"$/g, "") };
  if (type === "BLOCKED") return { reason: body.replace(/^reason\s*=\s*/, "").trim().replace(/^"|"$/g, "") };
  if (type === "CONTINUE") return { reason: body.replace(/^reason\s*=\s*/, "").trim().replace(/^"|"$/g, "") };

  const out: Record<string, string> = {};
  const kvRe = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = kvRe.exec(body)) !== null) {
    out[m[1]] = (m[2] !== undefined ? m[2] : m[3]).trim();
  }
  return out;
}

function publishState(state: VoiceState, window: BrowserWindow | null | undefined): void {
  lastState = state;
  if (window && !window.isDestroyed()) {
    window.webContents.send("aios:host-event", { event: "voice_state", state });
  }
}
