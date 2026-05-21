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

import { randomUUID } from "node:crypto";
import { flyCursorTo, showCursorMessage, setCursorBusy } from "./cursor-overlay";
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

DECISION PRIORITY — pick the right channel BEFORE acting:

  • If the user's request can be fulfilled by ANY of their CONNECTED
    SERVICES, USE THE SERVICE TOOL DIRECTLY via the Composio tool router:
      1. mcp__composio__COMPOSIO_SEARCH_TOOLS — finds the right slug
      2. mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL — runs it
    The allowed services list (45 of them) is in the scope-lock prompt
    you've already received — anything from gmail / google-calendar /
    slack / github / notion / clickup / stripe / youtube / drive / sheets
    / outlook / linkedin / whatsapp / twitter / telegram / facebook /
    instagram / supabase / airtable / discord / dropbox / onedrive /
    salesforce / calendly / google-meet / canva / reddit / cloudflare /
    excel / google-maps / etc. is fair game IF connected for this user.
    Don't drive the UI for things you can do over an API — it's slower
    and less reliable.
    Examples (not a closed list — the same pattern applies to ALL connected services):
      "send john an email saying I'll be late"        → GMAIL_SEND_EMAIL
      "what meetings do I have tomorrow"             → GOOGLECALENDAR_EVENTS_LIST
      "post 'standup in 5' to #team"                 → SLACK_SEND_MESSAGE
      "create a clickup task for the PR review"      → CLICKUP_CREATE_TASK
      "add a row to my budget sheet"                 → GOOGLESHEETS_BATCH_UPDATE
      "what's my Stripe balance"                     → STRIPE_RETRIEVE_BALANCE
      "send a tweet saying 'shipping today'"         → TWITTER_CREATE_TWEET
      "create a new Notion page titled 'Notes'"      → NOTION_CREATE_PAGE
      "what's the latest issue on my repo"           → GITHUB_LIST_ISSUES
    The same pattern applies to every other connected service. If the
    user names a service you don't see in the connected list, tell them
    plainly: "X isn't connected yet — open the Connectors page and
    connect it first."
    After the tool succeeds, write a 1-sentence confirmation and emit
    [DONE: <what got done via which service>]. The verifier accepts
    service-only DONEs without screen evidence — say plainly "Email
    sent." / "3 meetings tomorrow: ..." / "Tweet posted." etc.

  • If the user wants to drive THE UI of an app (click buttons, type into
    fields, scroll, open/close apps), use the action sentinels below.

  • Mixed tasks (e.g. "open Spotify and tweet about it") — do the UI
    piece via sentinels, the service piece via tool, in whichever order
    makes sense.

NEVER mention "Composio", "MCP", "tool router", or any internal plumbing
in your reply. Just do the work and report the outcome.

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

CRITICAL — sentinel requirement (no exceptions):

  Your reply MUST end with EXACTLY ONE sentinel like [OPEN: ...] /
  [CLICK: ...] / [TYPE: ...] / [DONE: ...] / [BLOCKED: ...] on its own
  final line. Replies WITHOUT a sentinel break the loop and the user
  sees an error. Even if the screenshot is empty / unhelpful / you only
  see AIOS itself — STILL pick an action:
    • If the target app isn't open yet → [OPEN: target="<App Name>"]
    • If you need clarification from the user → [BLOCKED: <what you need>]
    • If the request can't be done → [BLOCKED: <reason>]
  Never reply with conversational text alone — those go nowhere.

Platform notes:

  • On Windows: an accessibility tree (UIA) is usually available — use
    target_id ids when you have them.
  • On macOS: the accessibility tree is currently empty (Mac AX support
    lands in a later release). Rely on the screenshot alone — when you
    can't see the target app on screen, your FIRST action should be
    [OPEN: target="<App Name>"] to launch it. Then wait for the next
    turn's screenshot before clicking. Don't try to guess coordinates of
    apps that aren't visible.

Multi-step tasks (THIS IS THE COMMON CASE):

  When the user names more than one step in a single request (e.g.
  "open Notes and write a summary about magic teams"), DO NOT try to
  finish everything in turn 1. Plan the steps mentally then execute one
  per turn. Each new turn gets a fresh screenshot reflecting the result
  of your last action. The full user task is repeated in every turn's
  prompt — re-read it each time so you know what's still left.

  Worked example for the Notes case (macOS):
    Turn 1: [OPEN: target="Notes"]
       (sidecar launches Notes.app + brings it to the foreground)
    Turn 2: screenshot now shows Notes. To start a fresh note:
            [HOTKEY: keys="cmd+n"]
       (creates a new note; the input cursor lands in the editor)
    Turn 3: [TYPE: text="Summary about Magic teams:\\n\\n..."]
       (paragraph body — line breaks are real \\n inside the string)
    Turn 4: verify the text appeared in the screenshot. If yes:
            [DONE: New note created with Magic teams summary.]

  Same pattern on Windows uses Ctrl+N instead of Cmd+N. Note: use
  Ctrl on Windows, Cmd on Mac — pick from the user's platform context.

  Worked example for a service-tool task:
    User: "send john an email saying I'll be 10 minutes late"
    Turn 1: call mcp__composio__COMPOSIO_SEARCH_TOOLS for "GMAIL_SEND_EMAIL"
       then mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL with
       { to: "john@...", subject: "Running late",
         body: "I'll be 10 minutes late. Sorry!" }
       Then emit: [DONE: Email sent to john@...]

  Key rules for multi-step:
    • Always look at the freshest screenshot before deciding the next
      step. Don't assume — verify.
    • After [OPEN] use a HOTKEY (cmd+n / ctrl+n / etc.) to put yourself
      in the right input context before [TYPE]ing.
    • If the screen seems stuck or the previous action didn't take,
      emit [WAIT: seconds=1] for one turn, then re-evaluate.

KEYBOARD SHORTCUT vs CLICKING preference (Mac-honed):

  For creating a new native document / note / file in the current app,
  PREFER the hotkey path over clicking labels:
    • New note in Notes / Apple Mail / etc. → [HOTKEY: keys="cmd+n"]
    • New folder in Finder → [HOTKEY: keys="cmd+shift+n"]
    • New tab in any browser → [HOTKEY: keys="cmd+t"] (Mac) / "ctrl+t" (Win)
    • Save → [HOTKEY: keys="cmd+s"] / "ctrl+s"
    • Find in page → [HOTKEY: keys="cmd+f"] / "ctrl+f"
    • Cycle apps → [HOTKEY: keys="cmd+tab"] / "alt+tab"
    • Spotlight (Mac) → [HOTKEY: keys="cmd+space"]
  Sidebar / list items often have ambiguous labels (e.g. "New Note"
  could be a button OR an existing note titled "New Note"). The hotkey
  is unambiguous. Only fall back to clicking when no hotkey exists.

LANGUAGE rule (when labels exist):

  The user may speak any language. Reply in their language. BUT every
  label / target_id / element name you reference MUST be the literal
  text shown on screen — NEVER translate it. If macOS UI is Spanish
  and the user asks in English "open the Archivo menu", target the
  Spanish label "Archivo" exactly. The label that resolves is the one
  actually painted on screen.

SECURE-FIELD rule (NEVER override):

  NEVER emit [TYPE: ...] into a password, passcode, 2FA, credit-card,
  CVV, or secret-token field — even if the user explicitly asks.
  Instead: emit a [CLICK] that focuses the field so the cursor lands
  there, then [BLOCKED: I'll bring you to the field — please type the
  secret yourself]. AIOS will not log or auto-fill credentials.

LOGIN / 2FA / OAUTH-CONSENT rule:

  When a workflow lands on a sign-in form, an OAuth consent dialog
  ("Allow / Continue / Connect"), or a 2FA prompt, STOP. Emit
  [BLOCKED: You're signed-out / on a consent screen — please complete
  it yourself]. Do NOT auto-click Continue, Allow, or Sign in. These
  are user-only gates.

CONCRETE EXAMPLES (one action per turn):

  user: "open Notepad and write 'hello'"
    Turn 1: [OPEN: target="Notepad"]
    Turn 2: (Notepad is focused, cursor in editor)
            [TYPE: text="hello"]
    Turn 3: [DONE: Wrote 'hello' in a new Notepad document.]

  user: "open Notes app and write a summary about Magic teams"
    (Mac, Notes not running)
    Turn 1: [OPEN: target="Notes"]
    Turn 2: (Notes is in foreground)
            [HOTKEY: keys="cmd+n"]
    Turn 3: (new blank note; editor focused)
            [TYPE: text="Magic teams summary\\n\\nThe Magic..."]
    Turn 4: [DONE: New note created with Magic teams summary.]

  user: "save the document"
    Turn 1: [HOTKEY: keys="cmd+s"]
    Turn 2: (save sheet appears OR doc has unsaved → saved indicator)
            [DONE: Document saved.]

  user: "send john@x.com an email saying I'll be 10 min late"
    Turn 1: call mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL with
            tool_slug="GMAIL_SEND_EMAIL" and
            {to:"john@x.com", subject:"Running late",
             body:"I'll be about 10 minutes late, sorry!"}
    After tool succeeds: [DONE: Email sent to john@x.com via Gmail.]

  user: "log into my bank"
    Turn 1: [OPEN: target="https://your-bank.example"]
    Turn 2: [BLOCKED: You're on the sign-in page — please type your
            password yourself. I never auto-fill credentials.]

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
    Type into the focused field. clear=true selects-all + Delete FIRST
    (Cmd+A on Mac, Ctrl+A elsewhere — handled per-platform inside the
    runtime, you don't need to think about it), so the new text replaces
    whatever was there. ALWAYS use clear=true for address bars, search
    boxes, Run dialogs — they often have residual text.

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
  runId: string;
}

let activeRun: VoiceRun | null = null;
let lastState: VoiceState = { kind: "idle" };
// Bumped at startVoiceLoop entry. publishState below ignores any update
// whose runId doesn't match — this is the operation-token safety: stale
// callbacks from a prior run (sentinel handlers still in-flight, settle
// timers etc.) can't mutate the panel state for the new run.
let currentRunId: string = "";

export function getVoiceState(): VoiceState {
  return lastState;
}

export function isVoiceRunning(): boolean {
  return activeRun !== null;
}

export type VoiceEventBroadcast = (event: { event: "voice_state"; state: VoiceState }) => void;

export async function abortVoiceLoop(broadcast?: VoiceEventBroadcast | null): Promise<void> {
  if (!activeRun) return;
  activeRun.abort.abort();
  try {
    await activeRun.promise;
  } catch {
    /* swallow */
  }
  activeRun = null;
  publishState({ kind: "aborted" }, broadcast);
}

export interface StartVoiceLoopArgs {
  transcript: string;
  claudePath: string;
  host: PythonHost;
  broadcast: VoiceEventBroadcast;
  maxTurns?: number;
}

export async function startVoiceLoop({ transcript, claudePath, host, broadcast, maxTurns }: StartVoiceLoopArgs): Promise<{ ok: boolean; reason?: string; summary?: string }> {
  if (activeRun) {
    await abortVoiceLoop(broadcast);
  }
  const trimmed = transcript.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_transcript" };
  }
  if (!claudePath) {
    return { ok: false, reason: "claude_not_configured" };
  }

  // Fresh UUID for this run. Threaded into runLoop and checked before
  // every publishState so stale callbacks from the prior run (now aborted)
  // can't paint the panel for the new run.
  const runId = randomUUID();
  currentRunId = runId;

  // AX prewarm: kick off a tree walk the moment we start. Python caches
  // the result for 2s, so the first turn's parallel screen_ax_tree call
  // reuses the warm walk instead of paying ~1.5s of cold COM init. Fire
  // and forget — failures are silent (the first turn will retry anyway).
  host.invoke("screen_ax_tree", { maxElements: 120, timeBudget: 1.5 }).catch(() => undefined);

  const abort = new AbortController();
  const promise = runLoop({
    transcript: trimmed,
    claudePath,
    host,
    broadcast,
    signal: abort.signal,
    initialMaxTurns: Math.max(1, Math.min(ABSOLUTE_MAX_TURNS, maxTurns ?? DEFAULT_MAX_TURNS)),
    runId
  });
  activeRun = { abort, promise, runId };

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
  broadcast,
  signal,
  initialMaxTurns,
  runId
}: {
  transcript: string;
  claudePath: string;
  host: PythonHost;
  broadcast: VoiceEventBroadcast;
  signal: AbortSignal;
  initialMaxTurns: number;
  runId: string;
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
  // Foreground-window baseline captured on first turn. We compare against
  // it each subsequent turn to detect "user Cmd-Tabbed away mid-workflow"
  // (debounced 2 polls to avoid flickering on transient background windows
  // like notification toasts).
  let foregroundBaseline: { pid: number; app: string } | null = null;
  let foregroundDeviationCount = 0;

  // Publish wrapper: silently drops if this run is no longer the current
  // one. Stale settle-timer callbacks or in-flight async work can't paint
  // the panel for the next run.
  const publish = (state: VoiceState) => {
    if (runId !== currentRunId) return;
    publishState(state, broadcast);
  };

  while (turn < maxTurns) {
    if (signal.aborted) return { ok: false, reason: "aborted" };
    turn += 1;

    // Between-turn safety probe: did the user switch apps, or did a modal
    // pop up? Skip on the very first turn (no baseline yet).
    if (foregroundBaseline) {
      try {
        const probe = await host.invoke<{ available: boolean; foreground_app?: string; foreground_pid?: number; modal_present?: boolean }>("voice_check_environment", {});
        if (probe.ok && probe.data?.available) {
          if (probe.data.modal_present) {
            publish({ kind: "blocked", reason: "A modal dialog appeared — pausing so you can handle it. Re-run when ready." });
            return { ok: false, reason: "modal_appeared" };
          }
          const fgPid = probe.data.foreground_pid || 0;
          const fgApp = (probe.data.foreground_app || "").toLowerCase();
          const sameProcess = fgPid === foregroundBaseline.pid;
          const sameApp = fgApp === foregroundBaseline.app;
          if (!sameProcess && !sameApp) {
            foregroundDeviationCount += 1;
            // Debounce: require 2 consecutive different-app polls before
            // pausing. Background services briefly grabbing focus (e.g.
            // notification toast, UAC prompt about to appear) shouldn't
            // abort a long workflow.
            if (foregroundDeviationCount >= 2) {
              publish({
                kind: "blocked",
                reason: `Paused — you switched to ${probe.data.foreground_app || "another app"}. AIOS won't keep clicking inside a different app. Re-run when ready.`
              });
              return { ok: false, reason: "user_switched_app" };
            }
          } else {
            foregroundDeviationCount = 0;
          }
        }
      } catch {
        // Probe failures are non-fatal — fall through to the regular turn.
      }
    }

    publish({ kind: "thinking", turn });
    setCursorBusy(true);

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
      publish({ kind: "error", message: `Couldn't capture screen: ${message}` });
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
      publish({ kind: "error", message: `Claude error: ${message}` });
      return { ok: false, reason: "claude_failed" };
    }

    if (signal.aborted) return { ok: false, reason: "aborted" };

    let action = parseFirstSentinel(claudeReply);
    log("voice", "claude reply", { turn, action, replyHead: claudeReply.slice(0, 200) });

    // No-sentinel rescue: Claude sometimes responds with conversational
    // text (especially on Mac where the AX tree is empty and it leans on
    // vision-only reasoning) and forgets to emit the [ACTION:...] line.
    // Retry ONCE with a forceful nudge that includes its own chatty reply.
    // This catches ~all cases without bailing out to the user.
    if (!action && !signal.aborted) {
      publish({ kind: "thinking", turn });
      const nudge = [
        `STOP. Your previous reply had NO action sentinel — the voice loop CANNOT proceed.`,
        ``,
        `What you wrote (first 400 chars):`,
        `"${claudeReply.slice(0, 400).replace(/"/g, "'")}"`,
        ``,
        `User's task: "${transcript}"`,
        ``,
        `Pick exactly ONE concrete next step RIGHT NOW and end your reply with the matching sentinel:`,
        `  • Need to launch an app? → [OPEN: target="App Name"]`,
        `  • Click a labeled UI element? → [CLICK: target_id=N, label="..."] OR [CLICK: x=NUM, y=NUM]`,
        `  • Type text? → [TYPE: text="..."]`,
        `  • Press a hotkey? → [HOTKEY: keys="cmd+s"]`,
        `  • Wait for UI to settle? → [WAIT: seconds=1]`,
        `  • Task complete? → [DONE: summary]`,
        `  • Task impossible / need user input? → [BLOCKED: reason]`,
        ``,
        `Do NOT explain — pick a step. The sentinel MUST be on its own final line.`,
      ].join("\n");
      try {
        const retryRes = await host.invoke<{ response: string }>("run_task", {
          prompt: nudge,
          systemPrompt: SYSTEM_PROMPT,
          claudePath,
          model: "sonnet",
          imagesBase64: [screenshotB64]
        }, 60_000);
        if (retryRes.ok && retryRes.data?.response) {
          const retryReply = String(retryRes.data.response).trim();
          const retryAction = parseFirstSentinel(retryReply);
          if (retryAction) {
            action = retryAction;
            claudeReply = retryReply;
            log("voice", "no-sentinel rescued on retry", { turn, action: retryAction });
          }
        }
      } catch (err) {
        log("voice", "no-sentinel retry failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (!action) {
      // Even after the nudge Claude still didn't emit a sentinel. Likely it
      // wants something the loop can't deliver (like the user to clarify).
      // Surface as BLOCKED with the chatty text so the user can read it
      // and reply via the clarification-continuation path.
      const chat = claudeReply.slice(0, 280).trim();
      publish({
        kind: "blocked",
        reason: chat || "Couldn't determine an action. Try rephrasing with the app name first — e.g. 'open Notes and write a summary about Magic teams'."
      });
      return { ok: false, reason: "no_action" };
    }

    if (action.type === "DONE") {
      const summary = action.args.summary || claudeReply.replace(/\[DONE:[\s\S]*$/m, "").trim();
      // Verification pass: Claude has been over-eager about declaring DONE
      // when the actual outcome (music playing, file saved, etc.) hasn't
      // happened. Take a fresh screenshot 1.5s later and run a strict
      // verify call. If the verifier rejects, convert to BLOCKED instead
      // of accepting a false DONE.
      publish({ kind: "thinking", turn });
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
            `   the specific, falsifiable thing(s) that must be true for this`,
            `   task to genuinely be done. Be strict.`,
            ``,
            `2. Decide whether the criterion is VISIBLE-ON-SCREEN or`,
            `   SERVICE-ACTION-ONLY:`,
            `   - Visible-on-screen: "play music", "open Notepad", "scroll`,
            `     down". You need to see proof in the screenshot.`,
            `   - Service-action-only: "send email", "create calendar event",`,
            `     "post to Slack", "create task", "list my meetings". The`,
            `     agent calls a Composio service tool — no visible UI`,
            `     change is required. Trust the agent's summary if it`,
            `     plainly names the service action that succeeded.`,
            ``,
            `3. For VISIBLE-ON-SCREEN tasks: look at the attached fresh`,
            `   screenshot. Does the screen satisfy every part of your`,
            `   criterion? Reject if uncertain. A false-positive is much`,
            `   worse than a false-negative.`,
            ``,
            `4. For SERVICE-ACTION-ONLY tasks: accept if the agent's`,
            `   summary clearly names what was done (e.g. "Email sent to`,
            `   john@x.com", "Meeting created for 3pm Friday"). Reject if`,
            `   the summary is vague or hedged ("I tried to send" / "the`,
            `   email may have been sent").`,
            ``,
            `End your reply with EXACTLY ONE of these on its own final line:`,
            `  [VERIFIED: 1-sentence citation — visible evidence or named service action]`,
            `  [NOT_VERIFIED: what's missing — what you'd need to see / what the agent didn't confirm]`
          ].join("\n");
          const verifyRes = await host.invoke<{ response: string }>("run_task", {
            prompt: verifyPrompt,
            systemPrompt:
              "You are an independent verifier for an OS-control agent. The agent can either drive UI (visible changes on screen) or call connected service tools (Gmail, Calendar, Slack, etc — no visible change required). Derive the success criterion from the user's REQUEST. For visible tasks, check the screenshot strictly. For service-only tasks (send email, create event, post message, list items, etc), accept if the agent's summary clearly names the service action that succeeded; reject if the summary is vague or hedged. A false [VERIFIED] is the worst outcome you can produce.",
            claudePath,
            model: "sonnet",
            imagesBase64: [verifyScreen.data.png]
          }, 60_000);
          const reply = (verifyRes.ok && verifyRes.data?.response) || "";
          const verifiedMatch = reply.match(/\[VERIFIED:\s*([\s\S]*?)\]/);
          const notVerifiedMatch = reply.match(/\[NOT_VERIFIED:\s*([\s\S]*?)\]/);
          if (notVerifiedMatch && !verifiedMatch) {
            const why = notVerifiedMatch[1].trim();
            publish({
              kind: "blocked",
              reason: `Claimed done, but verification failed: ${why}`
            });
            return { ok: false, reason: "not_verified", summary: why };
          }
          // VERIFIED (or ambiguous reply) — accept the DONE.
        }
      } catch (err) {
        log("voice", "verification failed (accepting DONE anyway)", { error: err instanceof Error ? err.message : String(err) });
        // If verification itself errors, fall through to accepting DONE
        // rather than blocking on infrastructure issues.
      }
      publish({ kind: "done", summary });
      setCursorBusy(false);
      if (summary) showCursorMessage(`✓ ${summary.slice(0, 80)}`, 3000);
      return { ok: true, summary };
    }

    if (action.type === "BLOCKED") {
      const reason = action.args.reason || claudeReply.replace(/\[BLOCKED:[\s\S]*$/m, "").trim();
      publish({ kind: "blocked", reason });
      setCursorBusy(false);
      if (reason) showCursorMessage(`✕ ${reason.slice(0, 80)}`, 3500);
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
        publish({
          kind: "blocked",
          reason: `Stopped after the same action [${action.type}] was tried 3 times in a row without progress. The current approach isn't working — try restating your request more specifically.`
        });
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
    publish({ kind: "executing", turn, action, rationale });
    setCursorBusy(false);

    // Cursor companion narration: show what the agent is about to do
    // as a small bubble next to the user's cursor. Trims aggressively
    // so the text fits the bubble.
    const cursorMsg = describeAction(action, axElements);
    if (cursorMsg) showCursorMessage(cursorMsg.slice(0, 80), 2500);

    // For grounded CLICKs (target_id present), fly the cursor companion
    // to the target ~250ms BEFORE pyautogui actually fires the click.
    // Gives the user a visible cue of where the agent is about to act.
    if (action.type === "CLICK") {
      const tidRaw = action.args.target_id ?? action.args.targetId;
      if (tidRaw !== undefined && tidRaw !== "") {
        const tid = Number(tidRaw);
        const el = axElements.find((e) => e.id === tid);
        if (el) {
          const cx = Math.round(el.bounds.x + el.bounds.w / 2);
          const cy = Math.round(el.bounds.y + el.bounds.h / 2);
          flyCursorTo({ x: cx, y: cy, durationMs: 260 });
          await new Promise((r) => setTimeout(r, 280));
        }
      } else {
        const xn = Number(action.args.x);
        const yn = Number(action.args.y);
        if (Number.isFinite(xn) && Number.isFinite(yn)) {
          flyCursorTo({ x: xn, y: yn, durationMs: 260 });
          await new Promise((r) => setTimeout(r, 280));
        }
      }
    }

    let actionNote: string | undefined;
    try {
      const result = await executeAction(host, action, axElements);
      actionNote = result.note;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      publish({ kind: "error", message: `Action failed: ${message}` });
      setCursorBusy(false);
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

    // Update the foreground baseline so legitimate app-switches Claude
    // just performed (e.g. OPEN Chrome) become the new expected state.
    // Without this re-baseline, the next-turn check would flag the
    // intentional switch as "user took over". Quiet, best-effort.
    try {
      const refresh = await host.invoke<{ available: boolean; foreground_app?: string; foreground_pid?: number }>("voice_check_environment", {});
      if (refresh.ok && refresh.data?.available) {
        foregroundBaseline = {
          pid: refresh.data.foreground_pid || 0,
          app: (refresh.data.foreground_app || "").toLowerCase()
        };
        foregroundDeviationCount = 0;
      }
    } catch {
      /* probe failure non-fatal */
    }
  }

  publish({ kind: "error", message: `Stopped after ${maxTurns} turns.` });
  setCursorBusy(false);
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

function publishState(state: VoiceState, broadcast: VoiceEventBroadcast | null | undefined): void {
  lastState = state;
  if (broadcast) {
    try { broadcast({ event: "voice_state", state }); } catch { /* renderer disconnected */ }
  }
}
