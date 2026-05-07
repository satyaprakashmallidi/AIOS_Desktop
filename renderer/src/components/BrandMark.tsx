import React from "react";

type Variant = "filled" | "outline";

/**
 * AIOS Brand Mark — italic Instrument Serif "A" inside an ink ring,
 * with a small sage live-dot at the lower-right edge.
 *
 * The dot uses the same sage accent as the chat live-dot, threading
 * brand identity through the whole app.
 */
export function BrandMark({
  size = 32,
  variant = "filled",
  withDot = false,
  className,
  title = "AIOS"
}: {
  size?: number;
  variant?: Variant;
  withDot?: boolean;
  className?: string;
  title?: string;
}) {
  const isFilled = variant === "filled";
  const ringFill = isFilled ? "var(--ink, #0d0d0d)" : "transparent";
  const ringStroke = "var(--ink, #0d0d0d)";
  const ringStrokeWidth = isFilled ? 0 : 2;
  const letterFill = isFilled ? "var(--paper, #fafaf7)" : "var(--ink, #0d0d0d)";
  const dotFill = "var(--sage, #3d5a4a)";
  const dotRingFill = isFilled ? "var(--ink, #0d0d0d)" : "var(--paper, #fafaf7)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ width: size, height: size, flex: "0 0 auto", display: "block" }}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Ring */}
      <circle
        cx="32"
        cy="32"
        r={isFilled ? 30 : 29}
        fill={ringFill}
        stroke={ringStroke}
        strokeWidth={ringStrokeWidth}
      />
      {/* Italic A — Instrument Serif */}
      <text
        x="32"
        y="46"
        textAnchor="middle"
        fontFamily="'Instrument Serif', 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="400"
        fontSize="42"
        fill={letterFill}
      >
        A
      </text>
      {/* Live-dot — sage, with a paper/ink halo so it reads on either background */}
      {withDot ? (
        <>
          <circle cx="51" cy="49" r="6" fill={dotRingFill} />
          <circle cx="51" cy="49" r="4" fill={dotFill} />
        </>
      ) : null}
    </svg>
  );
}
