# Frontend Design — AIOS Module

**Get polished HTML mockups from your app scope. Pick a visual style, get a working prototype, build with confidence.**

---

## What This Is

A Claude Code skill that gives you a design step before you write production code. Describe what you're building, pick from 9 curated visual styles, and get a working HTML mockup in minutes.

The mockup becomes your visual reference for the entire build — consistent colors, fonts, spacing — so you're not making layout decisions mid-code.

## The Workflow

This module is designed to slot into the `/new-app` workflow:

```
/new-app (Phase 1: scope)
    ↓
"Do you have UI references?" → No → pause
    ↓
/frontend-design → HTML mockup
    ↓
Back to /new-app with designs → Phase 2 onwards
    ↓
/create-plan + /implement (build with a visual reference locked in)
```

Works standalone too — any time you need a design mockup, run it.

## The Example Library

9 real HTML designs Claude reads before building anything:

| Example | Aesthetic |
|---------|-----------|
| creative-coder | Neo-brutalist, bold borders, playful |
| cloakclaw | Dark hacker, red glows, terminal |
| pony-house | Cinematic SaaS, 3D hero, atmospheric dark |
| stratum | Industrial skeuomorphic, metal textures |
| ux-jonny | Swiss minimal, monochrome, editorial |
| jalapao | Earthy brutalist, rust-orange, gritty |
| sunplanet | Editorial luxury, warm cream, restrained |
| rinkuu-gopalani | Dark luxury, forest-green + rose |
| nexus (8 pages) | Cinematic dark SaaS, full multi-page site |

These are the actual source files Claude reads — not descriptions, not prompts. It absorbs the CSS patterns, component structures, and spatial logic, then adapts them to your brand and content.

## What's In The Box

```
aios-module-frontend-design/
├── INSTALL.md                          # Give this to Claude Code to set up
├── README.md                           # This file
├── skill/
│   ├── SKILL.md                        # The skill Claude uses when designing
│   └── references/
│       ├── example-catalog.md          # Quick reference: CSS snippets for all 9 examples
│       └── design-system-template.md   # Template for Phase 2 design system extraction
└── examples/
    ├── creative-coder.html
    ├── cloakclaw.html
    ├── pony-house.html
    ├── stratum.html
    ├── ux-jonny.html
    ├── jalapao.html
    ├── sunplanet.html
    ├── rinkuu-gopalani.html
    └── nexus/                          # 8-page multi-page SaaS site
        ├── Polar Index.html
        ├── Polar Features.html
        ├── Polar Solutions.html
        ├── Polar Pricing.html
        ├── Polar Company.html
        ├── Polar Workflow.html
        ├── Open Roles - Polar.html
        └── Polar Sign In.html

```

## Setup

**Hand the folder to Claude Code and say:**

> "Read INSTALL.md and help me set this up step by step."

Claude will walk you through the installation interactively. Takes 3-5 minutes.

**Requirements:** Claude Code CLI. No API keys. No external services.

## Phase 2: Design System Extraction

Once you have a mockup you're happy with, say "lock this in" or "extract the design system." Claude converts your prototype into three reusable files:

- `tokens.css` — all CSS custom properties (colors, spacing, type, radii)
- `components.css` — every reusable visual pattern as a class
- `DESIGN.md` — human/AI-readable spec with font CDN links, palette, do/don't rules

These live at `{your-app}/design-system/` and keep your styling consistent across every coding session. The companion `app-design-system` skill (included in `/new-app`) auto-enforces these tokens whenever you build frontend code.

---

> Part of the AAA Accelerator AIOS Module Library.
> [aaaaccelerator.com](https://aaaaccelerator.com)
