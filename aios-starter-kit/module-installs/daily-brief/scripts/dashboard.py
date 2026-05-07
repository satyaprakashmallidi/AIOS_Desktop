"""
Daily Brief — Dashboard Image Generator

Creates a dark-themed funnel dashboard PNG from your metrics data.
The stages and metrics are driven by your funnel.md — this adapts
to whatever business you run.

Uses matplotlib with no display backend (works in cron jobs).
"""

import io
import matplotlib
matplotlib.use("Agg")  # No display needed
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from pathlib import Path

# Color scheme — dark premium theme
BG_COLOR = "#1a1a2e"
CARD_COLOR = "#16213e"
TEXT_COLOR = "#e8e8e8"
MUTED_COLOR = "#8b8b9e"
GREEN = "#4ade80"
RED = "#f87171"
ACCENT = "#818cf8"
HEADER_COLOR = "#c084fc"


def generate_dashboard_image(metrics, width=600, save_path=None):
    """Generate a funnel dashboard PNG from metrics data.

    Args:
        metrics: Dict from metrics.build_funnel_metrics()
        width: Image width in pixels (height scales automatically)
        save_path: Optional path to save PNG (returns bytes regardless)

    Returns:
        PNG image as bytes
    """
    stages = metrics.get("stages", [])
    if not stages:
        return _generate_empty_dashboard(metrics.get("date", ""))

    currency = metrics.get("currency", "$")
    date = metrics.get("date", "")

    # Calculate dimensions
    rows_needed = sum(
        max(len(s["metrics"]), 1) for s in stages
    )
    height = 80 + rows_needed * 32 + len(stages) * 50 + 40

    fig_w = width / 100
    fig_h = height / 100

    fig, ax = plt.subplots(figsize=(fig_w, fig_h))
    fig.patch.set_facecolor(BG_COLOR)
    ax.set_facecolor(BG_COLOR)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    # Title
    ax.text(
        0.5, 0.98, f"DAILY BRIEF — {date}",
        ha="center", va="top",
        fontsize=11, fontweight="bold", color=HEADER_COLOR,
        transform=ax.transAxes,
    )

    # Draw stages
    y_pos = 0.92
    total_height = 0.92 - 0.04
    stage_height = total_height / len(stages)

    for stage in stages:
        # Stage header
        ax.text(
            0.04, y_pos, stage["name"].upper(),
            fontsize=9, fontweight="bold", color=ACCENT,
            transform=ax.transAxes,
        )
        y_pos -= 0.025

        # Description
        if stage.get("description"):
            ax.text(
                0.04, y_pos, stage["description"],
                fontsize=6.5, color=MUTED_COLOR,
                transform=ax.transAxes,
            )
            y_pos -= 0.02

        # Metrics
        for m in stage["metrics"]:
            if m["value"] is None:
                continue

            # Format value
            val = m["value"]
            if isinstance(val, (int, float)) and val >= 10000:
                val_str = f"{val:,.0f}"
            elif isinstance(val, float):
                val_str = f"{val:.1f}"
            else:
                val_str = str(val)

            # Label
            ax.text(
                0.06, y_pos, m["label"],
                fontsize=7.5, color=MUTED_COLOR,
                transform=ax.transAxes,
            )

            # Value
            ax.text(
                0.52, y_pos, val_str,
                fontsize=7.5, fontweight="bold", color=TEXT_COLOR,
                ha="right", transform=ax.transAxes,
            )

            # 7-day average comparison
            if m["avg_7d"] is not None:
                direction = m.get("direction", "on_par")
                if direction == "above":
                    color = GREEN
                    arrow = "↑"
                elif direction == "below":
                    color = RED
                    arrow = "↓"
                else:
                    color = MUTED_COLOR
                    arrow = "→"

                avg_val = m["avg_7d"]
                if isinstance(avg_val, (int, float)) and avg_val >= 10000:
                    avg_str = f"{avg_val:,.0f}"
                elif isinstance(avg_val, float):
                    avg_str = f"{avg_val:.1f}"
                else:
                    avg_str = str(avg_val)

                ax.text(
                    0.56, y_pos, f"{arrow} avg {avg_str}",
                    fontsize=6.5, color=color,
                    transform=ax.transAxes,
                )

            y_pos -= 0.035

        # Separator line
        y_pos -= 0.01
        ax.axhline(
            y=y_pos, xmin=0.04, xmax=0.96,
            color="#2a2a4e", linewidth=0.5,
            transform=ax.transAxes,
        )
        y_pos -= 0.02

    # Targets footer
    targets = metrics.get("targets", {})
    if targets:
        ax.text(
            0.04, y_pos, "TARGETS",
            fontsize=7, fontweight="bold", color=MUTED_COLOR,
            transform=ax.transAxes,
        )
        y_pos -= 0.025
        for name, target in targets.items():
            ax.text(
                0.06, y_pos, f"{name}: {target}",
                fontsize=6.5, color=MUTED_COLOR,
                transform=ax.transAxes,
            )
            y_pos -= 0.02

    # Save to bytes
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight",
                facecolor=BG_COLOR, edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    image_bytes = buf.read()

    if save_path:
        Path(save_path).write_bytes(image_bytes)

    return image_bytes


def _generate_empty_dashboard(date):
    """Generate a minimal dashboard when no metrics are available."""
    fig, ax = plt.subplots(figsize=(6, 2))
    fig.patch.set_facecolor(BG_COLOR)
    ax.set_facecolor(BG_COLOR)
    ax.axis("off")

    ax.text(
        0.5, 0.6, f"DAILY BRIEF — {date}",
        ha="center", va="center",
        fontsize=11, fontweight="bold", color=HEADER_COLOR,
    )
    ax.text(
        0.5, 0.3, "No funnel metrics available yet. Run data collection first.",
        ha="center", va="center",
        fontsize=8, color=MUTED_COLOR,
    )

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight",
                facecolor=BG_COLOR, edgecolor="none")
    plt.close(fig)
    buf.seek(0)
    return buf.read()


if __name__ == "__main__":
    """Quick test — generate a sample dashboard."""
    sample_metrics = {
        "date": "2026-02-27",
        "currency": "USD",
        "stages": [
            {
                "name": "Awareness",
                "description": "How people find you",
                "metrics": [
                    {"label": "YouTube Views", "value": 15234, "avg_7d": 12100, "direction": "above", "date": "2026-02-27"},
                    {"label": "Website Sessions", "value": 1820, "avg_7d": 1900, "direction": "below", "date": "2026-02-27"},
                ],
            },
            {
                "name": "Conversion",
                "description": "Prospects becoming customers",
                "metrics": [
                    {"label": "Demo Bookings", "value": 8, "avg_7d": 6.2, "direction": "above", "date": "2026-02-27"},
                ],
            },
            {
                "name": "Revenue",
                "description": "Money in the bank",
                "metrics": [
                    {"label": "Revenue MTD", "value": 42500, "avg_7d": None, "direction": "on_par", "date": "2026-02-27"},
                    {"label": "Active Subs", "value": 45, "avg_7d": 43, "direction": "above", "date": "2026-02-27"},
                ],
            },
        ],
        "targets": {"Monthly Revenue": "$50,000", "New Customers": "10"},
    }

    img_bytes = generate_dashboard_image(sample_metrics, save_path="test_dashboard.png")
    print(f"Dashboard generated: {len(img_bytes):,} bytes → test_dashboard.png")
