import React, { useEffect, useRef, useState } from "react";

// Fullscreen click-through cursor companion.
//
// Subscribes to:
//   aios:cursor-position  — 60Hz mouse coords (de-duped in main)
//   aios:cursor-type      — 10Hz OS cursor classification (arrow / ibeam / hand / ...)
//   aios:cursor-color     — user-picked fill color
//   aios:cursor-fly-to    — animate to (x, y) over durationMs (before clicks)
//   aios:cursor-message   — show a text bubble next to the cursor
//   aios:cursor-busy      — swap arrow for spinner while agent is thinking
//
// The companion TRAILS the cursor with a 22px below-right offset and a
// soft lerp toward the target each animation frame — gives it the
// "follower" feel and stops it from ever sitting on top of the real OS
// cursor. The sprite swaps to match the OS cursor type so it stays
// contextual (typing → I-beam, hovering link → hand, etc).

const FADE_OUT_DELAY_MS = 700;
// Companion sits AT the cursor position with no offset. The lerp below
// already gives a slight natural lag during fast moves — that reads as
// "following" without ever drifting away from the cursor.
const TRAIL_OFFSET_X = 0;
const TRAIL_OFFSET_Y = 0;
const LERP_ALPHA = 0.32;

type CursorType = "arrow" | "ibeam" | "hand" | "wait" | "cross" | "no" | "help" | "app_starting" | string;

export function CursorOverlayApp() {
  const spriteRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<{ x: number; y: number }>({ x: -100, y: -100 });
  const currentRef = useRef<{ x: number; y: number }>({ x: -100, y: -100 });
  const stopTimerRef = useRef<number | null>(null);
  const visibleRef = useRef(false);
  const flyingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const [color, setColor] = useState<string>("#9caf9b");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [type, setType] = useState<CursorType>("arrow");

  const apply = (x: number, y: number) => {
    const el = spriteRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const showSprite = () => {
    if (visibleRef.current) return;
    visibleRef.current = true;
    const el = spriteRef.current;
    if (el) el.style.opacity = "1";
  };

  const hideSprite = () => {
    if (!visibleRef.current) return;
    visibleRef.current = false;
    const el = spriteRef.current;
    if (el) el.style.opacity = "0";
  };

  // Continuous lerp toward target — smooth trailing.
  useEffect(() => {
    const step = () => {
      if (!flyingRef.current) {
        currentRef.current.x += (targetRef.current.x - currentRef.current.x) * LERP_ALPHA;
        currentRef.current.y += (targetRef.current.y - currentRef.current.y) * LERP_ALPHA;
        apply(currentRef.current.x, currentRef.current.y);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const unsubPos = window.aios?.onCursorPosition?.((pos) => {
      // Trail with an offset so the companion never overlaps the real
      // OS cursor — it's beside the cursor, not under it.
      targetRef.current = { x: pos.x + TRAIL_OFFSET_X, y: pos.y + TRAIL_OFFSET_Y };
      showSprite();
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = window.setTimeout(() => {
        if (!busy) hideSprite();
      }, FADE_OUT_DELAY_MS);
    });

    const unsubColor = window.aios?.onCursorColor?.((c) => setColor(c));
    const unsubType = window.aios?.onCursorType?.((t) => setType(t as CursorType));

    const unsubFly = window.aios?.onCursorFlyTo?.((target) => {
      const el = spriteRef.current;
      if (!el) return;
      flyingRef.current = true;
      el.style.transition = `transform ${target.durationMs}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 200ms ease`;
      showSprite();
      // Apply with the trail offset so the fly-to also lands beside the
      // target, not directly on it.
      apply(target.x + TRAIL_OFFSET_X, target.y + TRAIL_OFFSET_Y);
      currentRef.current = { x: target.x + TRAIL_OFFSET_X, y: target.y + TRAIL_OFFSET_Y };
      targetRef.current = currentRef.current;
      window.setTimeout(() => {
        flyingRef.current = false;
        if (el && el.isConnected) {
          el.style.transition = `opacity 200ms ease`;
        }
      }, target.durationMs + 40);
    });

    const unsubMsg = window.aios?.onCursorMessage?.((m) => {
      setMessage(m.text);
      window.setTimeout(() => setMessage(null), m.durationMs);
    });

    const unsubBusy = window.aios?.onCursorBusy?.((s) => {
      setBusy(s.busy);
      if (s.busy) showSprite();
    });

    return () => {
      unsubPos?.();
      unsubColor?.();
      unsubType?.();
      unsubFly?.();
      unsubMsg?.();
      unsubBusy?.();
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    };
  }, [busy]);

  return (
    <div className="cursor-overlay-root" aria-hidden="true">
      <div ref={spriteRef} className={`cursor-sprite is-type-${type}${busy ? " is-busy" : ""}`}>
        {busy ? <BusySprite color={color} /> : <SpriteForType type={type} color={color} />}
        {message ? <div className="cursor-bubble">{message}</div> : null}
      </div>
    </div>
  );
}

function SpriteForType({ type, color }: { type: CursorType; color: string }) {
  if (type === "ibeam") {
    // I-beam: small vertical line with serifs, ~14px tall.
    return (
      <svg className="cursor-svg cursor-svg-ibeam" width="10" height="16" viewBox="0 0 10 16">
        <path
          d="M5 1 V15 M2 1 H8 M2 15 H8"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M5 1 V15 M2 1 H8 M2 15 H8"
          stroke="#ffffff"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          opacity="0.35"
          transform="translate(0,0)"
          style={{ mixBlendMode: "screen" }}
        />
      </svg>
    );
  }
  if (type === "hand" || type === "help") {
    // Pointing-hand glyph (small finger). Simplified silhouette.
    return (
      <svg className="cursor-svg cursor-svg-hand" width="14" height="16" viewBox="0 0 14 16">
        <path
          d="M5 1 L5 7 L7 7 L7 4 L9 4 L9 8 L10 8 L10 5 L12 5 L12 14 L3 14 L1 9 L3 9 Z"
          fill={color}
          stroke="#ffffff"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (type === "cross") {
    return (
      <svg className="cursor-svg" width="14" height="14" viewBox="0 0 14 14">
        <path d="M7 1 V13 M1 7 H13" stroke={color} strokeWidth="2" strokeLinecap="round" />
        <path d="M7 1 V13 M1 7 H13" stroke="#ffffff" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
      </svg>
    );
  }
  if (type === "no") {
    return (
      <svg className="cursor-svg" width="14" height="14" viewBox="0 0 14 14">
        <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.6" />
        <path d="M3 3 L11 11" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  // Default: classic pointer-arrow ~14×17, AIOS color fill + white outline.
  return (
    <svg className="cursor-svg cursor-svg-arrow" width="14" height="17" viewBox="0 0 14 17">
      <path
        d="M1 1 L1 13 L4 10 L6 15 L9 14 L7 9 L11 9 Z"
        fill={color}
        stroke="#ffffff"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BusySprite({ color }: { color: string }) {
  return (
    <svg className="cursor-spinner" width="18" height="18" viewBox="0 0 18 18">
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="11 30"
      />
    </svg>
  );
}
