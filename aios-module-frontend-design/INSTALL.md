# Frontend Design — AIOS Module Installer

> A plug-and-play module from the AAA Accelerator.
> Grab this and 15+ more at [aaaaccelerator.com](https://aaaaccelerator.com)

---

## FOR CLAUDE

You are helping a user install this AIOS Module. Follow these rules:

**Behavior:**
- Assume the user is non-technical unless they tell you otherwise
- Explain what you are doing at each step in plain English BEFORE doing it
- Celebrate small wins ("The design example library is installed — you now have 9 real designs Claude can draw from!")
- If something fails, do not dump error logs — explain the problem simply and suggest the fix
- Never skip verification steps — if a check fails, stop and help the user fix it
- Use encouraging language throughout — they are building something real

**Pacing:**
- Do NOT rush. Pause after major milestones.
- After prerequisites: "Everything looks good. Ready to install?"
- After installation: "Files are in place. Let's verify everything worked."
- After test: "You're all set! Here's exactly how to use this in your app-building workflow."

**Error handling:**
- If `.claude/` folder doesn't exist → they need Claude Code installed and a workspace set up first
- If files already exist at the target paths → ask before overwriting
- Never say "check the logs" — find the problem and explain it

**Important — this module includes HTML example files:**
This module is distributed as a zip folder. The HTML design examples cannot be embedded inline — they are large source files. Step 4 asks the user where they extracted the zip, then uses that path to copy the files. Always get the full path from the user before running the copy commands.

---

## OVERVIEW

This module gives you a `/frontend-design` skill — a design step that fits into the middle of your app-building workflow.

Here's the problem it solves: when you start building an app, you know what it should *do*, but you don't know what it should *look like*. Building without a visual reference means you make layout decisions mid-code, revise constantly, and usually end up with something generic that looks like every other AI-generated dashboard.

This module fixes that with a dead-simple step: before you write production code, describe what you're building and pick a visual style. Claude reads from a library of 9 real, curated HTML designs — not AI slop, but actual distinctive design systems covering everything from cinematic dark SaaS to neo-brutalist to Swiss minimal to industrial skeuomorphic. It uses those as reference, builds you a lightweight HTML mockup in minutes, and you have a visual to build against.

**Where this fits in your workflow:**

If you're using `/new-app` (the companion module), the flow is:

1. `/new-app` — Phase 1: scope your app (name, purpose, screens, data)
2. Gets asked "do you have any UI references or design mockups?" → **pause here**
3. Run this skill: describe what you're building, pick a style, get an HTML mockup
4. Go back to `/new-app` with your mockup: "here are the designs, continue"
5. Phase 2 onwards: Claude now has a visual reference locked in

If you're NOT using `/new-app`, you can use this standalone any time you need a design mockup.

**What you'll have when it's done:** A skill that auto-activates when you say things like "design my app", "mock this up", "I need a frontend for...", or explicitly run `/frontend-design`. It draws from 9 curated HTML examples and produces a polished, working HTML file you can open in a browser.

**Where it installs:** Into `.claude/skills/` in your current workspace. Once installed, it's available in every Claude Code session you open in that workspace — no further setup needed.

**Setup time:** 3-5 minutes (just installing files — no API keys, no external services).

**Running cost:** Free. Google Fonts and Tailwind CDN only.

---

## SCOPING

**RECOMMENDED** (install the full skill with all 9 design examples)
- The frontend-design skill (auto-activates on design/build requests)
- Full example library (all 9 HTML designs + the nexus multi-page SaaS site)
- Reference files (design catalog, design system extraction template)

Estimated setup time: 3-5 minutes

**CUSTOM** (lighter install)
- Option 1: Skip the nexus multi-page example (8 extra files, only needed for multi-page SaaS sites)
- Option 2: Install only specific examples that match your aesthetic (ask the user which style they prefer)

Ask: "Want to go with RECOMMENDED (everything), or would you like to walk through the options?"

If RECOMMENDED → proceed with all components.
If CUSTOM → show the example list below, let them pick, install only those.

**Example list for CUSTOM:**
- `creative-coder` — Neo-brutalist, bold borders, playful (agencies, creative brands)
- `cloakclaw` — Dark hacker, red glows, terminal (developer tools, infra, DeFi)
- `pony-house` — Cinematic SaaS, 3D hero, atmospheric dark (premium SaaS, dev platforms)
- `stratum` — Industrial skeuomorphic, metal textures (hardware, audio, premium dark)
- `ux-jonny` — Swiss minimal, monochrome, editorial (clean portfolios, design agencies)
- `jalapao` — Earthy brutalist, rust-orange, gritty (adventure, organic/raw brands)
- `sunplanet` — Editorial luxury, warm cream, restrained (luxury, travel, editorial)
- `rinkuu-gopalani` — Dark luxury, forest-green + rose (fashion, galleries, artisan)
- `nexus` (8 pages) — Cinematic dark SaaS, full multi-page site (SaaS products, dashboards)

---

## PREREQUISITES

Check each prerequisite. Verify it works before proceeding.

### Claude Code CLI
```bash
claude --version
```
If not installed:
```bash
npm install -g @anthropic-ai/claude-code
```
If npm is not available: install Node.js first from https://nodejs.org (download the LTS version, run the installer).

### Workspace .claude/ folder
```bash
ls .claude/
```
You should see a `.claude/` folder in your workspace root. If it doesn't exist:
```bash
mkdir -p .claude/commands .claude/skills
```

[VERIFY] Both checks pass without errors.

Ask: "Everything looks good. Ready to install?"

---

## INSTALL

### Step 1: Create the skill folder

```bash
mkdir -p .claude/skills/frontend-design/examples/nexus
mkdir -p .claude/skills/frontend-design/references
```

### Step 2: Install the skill definition

Write the following file to `.claude/skills/frontend-design/SKILL.md`:

````markdown
---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics. Has a library of 9 curated design examples (including one multi-page SaaS site) that can be referenced, blended, or adapted to any brand or context. Trigger words include design, build, style, beautify, UI, frontend, landing page, dashboard, website, component, mockup, prototype.
---

## What This Skill Does

Create distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Build real working code with exceptional attention to aesthetic details and creative choices.

## Design Example Library

This skill includes 9 curated HTML design examples in `examples/`. **Always consult these before designing.**

### Step 1: Read the Catalog

Read `references/example-catalog.md` — condensed design systems with actual CSS code snippets for each example.

### Step 2: Match or Blend

| Example | Aesthetic | Best For |
|---------|-----------|----------|
| **creative-coder** | Neo-brutalist, playful, bold borders | Fun brands, creative portfolios, agencies |
| **cloakclaw** | Dark hacker, red glows, terminal | Developer tools, DeFi, security, infra |
| **pony-house** | Cinematic SaaS, 3D hero, atmospheric | Premium SaaS, developer platforms |
| **stratum** | Industrial skeuomorphic, metal textures | Hardware, audio, premium dark products |
| **ux-jonny** | Swiss minimal, monochrome, editorial | Clean portfolios, design agencies |
| **jalapao** | Earthy brutalist, gritty, rust-orange | Adventure brands, raw/organic products |
| **sunplanet** | Editorial luxury, warm cream, restrained | Luxury brands, editorial, travel |
| **rinkuu-gopalani** | Dark luxury, forest-green + rose | Fashion, artisan brands, galleries |
| **nexus** (multi-page) | Cinematic dark SaaS, glass panels, film grain | SaaS products, dashboards, multi-page sites |

**Blend approaches:**
- Take color palette from one, component patterns from another, typography from a third
- Adapt a dark example to light mode (or vice versa) by inverting the palette logic
- Use one example's signature CSS patterns (shadows, textures, animations) on a different layout structure

### Step 3: Read Full Example Sources

**IMPORTANT:** The catalog gives you the distilled patterns, but to produce truly high-quality output you MUST read the full source files for your chosen reference examples. The catalog is a map — the HTML files are the territory.

**Always read at minimum 2-3 full example files** before building. Pick the examples closest to the target aesthetic and read them end-to-end. This gives you:
- Complete CSS variable systems and how they're applied across components
- Real component HTML structure (not just class names)
- How animations, hover effects, and transitions are actually wired
- The spatial relationships, padding, and rhythm that make the design work

**For multi-page sites** like `nexus/`, read at least the index page plus the page most relevant to what you're building (e.g., `nexus/Polar Pricing.html` if building pricing cards).

**Reading order:**
1. `references/example-catalog.md` — scan all entries, identify 2-3 closest matches
2. Full HTML source for those 2-3 examples — absorb the complete design system
3. Build with those patterns deeply internalized, adapting to the user's brand/content

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: What aesthetic direction? Use the example library for grounded inspiration.
- **Differentiation**: What's the ONE thing someone will remember about this design?
- **Example base**: Which 1-2 examples are closest to what we need?

**CRITICAL**: Choose a clear conceptual direction and execute with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

## How to Use Examples

**Close copy (same vibe, different content):**
1. Read the full HTML source
2. Restructure for the new content/purpose
3. Keep the color system, typography, shadow/texture patterns, and component styles
4. Swap content, adjust layout grid to fit

**Derivative (inspired by, adapted):**
1. Read the catalog entry for CSS patterns
2. Pull specific techniques: shadow system, texture overlays, animation patterns, component structures
3. Apply to a new color palette and font stack
4. Keep the signature moves that make the example distinctive

**Blend (combine 2-3 examples):**
1. Define which aspects come from which example (color + type from A, components from B, texture from C)
2. Read catalog entries for all referenced examples
3. Build a unified CSS variable system that merges the palettes
4. Ensure patterns from different examples don't conflict visually

## Frontend Aesthetics Guidelines

- **Typography**: Avoid generic fonts (Arial, Inter, Roboto, system fonts). Use distinctive choices — the examples use Syne, Space Grotesk, DM Sans, Cabinet Grotesk, Instrument Serif, Cormorant Garamond, Anton, Manrope, Geist.
- **Color**: Commit to a cohesive palette with CSS variables. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: One well-orchestrated page load with staggered reveals creates more delight than scattered micro-interactions. Key patterns: blur-in reveals, clip-path wipes, hover shadow escalation, count-up metrics.
- **Textures**: Create atmosphere — noise grain overlays, brushed metal, dot grids, tech grids with radial masks, blob backgrounds, ambient glow blobs.
- **Layout**: Unexpected compositions — 12-col asymmetric splits, bento grids with mixed spans, staggered masonry offsets, negative space between text lines.

**NEVER** use: overused fonts (Inter, Roboto, Arial, system fonts), purple gradients on white, predictable card grids, generic dark mode (#1a1a2e backgrounds), cookie-cutter shadows.

## Implementation

Default to single-file HTML with Tailwind v4 CDN + Google Fonts unless the user specifies a framework. Include all CSS in a `<style>` block and JS in a `<script>` block. The file should open in a browser and look exactly as designed.

## Phase 2: Extract Design System

After the user selects a winning prototype ("let's use this", "this is the one", "lock this in", "extract the design system"), convert it into a structured, reusable design system.

### When to Trigger

- User picks a winning prototype from the exploration phase
- User asks to extract, lock, or codify a design from an existing HTML file
- User wants to create a design system for an app from a reference file

### Process

1. **Read the winning HTML file** end-to-end. Identify every CSS variable, font import, reusable component pattern, color value, spacing value, and animation.

2. **Ask which app this is for** if not obvious from context. The design system lives at `{app-root}/design-system/`.

3. **Read the template:** `references/design-system-template.md` — follow this structure for all 3 output files.

4. **Extract into 3 files:**

   | File | Contents |
   |------|----------|
   | `tokens.css` | All CSS custom properties: colors, spacing, radii, shadows, typography, transitions |
   | `components.css` | Every reusable visual pattern as a self-contained class, with hover/active states and animation keyframes |
   | `DESIGN.md` | Human/AI-readable spec: font CDN links, color palette table, component inventory, do/don't rules |

5. **Validate:** Every hex color from the prototype maps to a token. Every repeated visual pattern has a component class. Font CDN URLs documented. Do/don't rules capture what makes the design distinctive.

### Output Location

```
{app-root}/design-system/
  tokens.css
  components.css
  DESIGN.md
```

After extraction, tell the user: "Design system locked. If you're using /new-app, go back to that session and share this file. Claude will use it as the visual reference for your entire build."
````

[VERIFY]
```bash
cat .claude/skills/frontend-design/SKILL.md | head -5
```
Expected: File starts with `---` (YAML frontmatter).

### Step 3: Install the reference files

Write the following two files to the skill references folder.

**File 1** — Write `.claude/skills/frontend-design/references/example-catalog.md`:

````markdown
# Example Design Catalog

> Condensed reference for all design examples in `examples/`. Each entry captures the vibe, palette, typography, and **reusable CSS patterns** with actual code. Read this first for inspiration, then read the full HTML file for the complete picture.

---

## creative-coder

**Vibe:** Neo-brutalist portfolio. Bold geometric shapes, hard black borders, saturated accent colors, soft organic blob backgrounds. Playful, high-energy, "serious craft with irreverent presentation."

**Palette:**
- Background: `#FFFDF5` (warm cream)
- Borders/text: `#000000`
- Yellow: `#FDE047` | Pink: `#F9A8D4` | Blue: `#2563EB`

**Fonts:** `Syne` (display, 400-800) + `Space Grotesk` (body, 300-600)

**Signature CSS:**
```css
/* Neo-brutalist shadow system */
.neo-shadow    { box-shadow: 6px 6px 0px 0px rgba(0,0,0,1); }
.neo-shadow-sm { box-shadow: 3px 3px 0px 0px rgba(0,0,0,1); }
.neo-shadow-hover:hover {
  transform: translate(-2px, -2px);
  box-shadow: 8px 8px 0px 0px rgba(0,0,0,1);
}

/* Button press-down */
.btn:hover { transform: translateY(2px); box-shadow: none; }

/* Blob background */
@keyframes move-blob {
  0%   { transform: translate(0px, 0px) scale(1); }
  33%  { transform: translate(30px, -50px) scale(1.1); }
  66%  { transform: translate(-20px, 20px) scale(0.9); }
  100% { transform: translate(0px, 0px) scale(1); }
}
/* Applied to large circles with mix-blend-multiply filter blur-3xl opacity-30 */

/* Stroke-only text */
.text-outline { -webkit-text-stroke: 1.5px black; color: transparent; }

/* Highlighted word with skewed bg */
<span class="relative inline-block px-4">
  <span class="absolute inset-0 bg-[#FDE047] -skew-y-2 border-2 border-black neo-shadow-sm -z-10"></span>
  WORD
</span>

/* Nav with auto color inversion */
nav { mix-blend-mode: difference; }

/* Custom cursor */
.cursor-dot { width: 8px; height: 8px; background: black; }
.cursor-circle { width: 40px; height: 40px; border: 1px solid rgba(0,0,0,0.5); }
body:has(a:hover) .cursor-circle {
  transform: translate(-50%, -50%) scale(2);
  background: rgba(253, 224, 71, 0.3);
}
```

**Key patterns:** Layered cards (colored bg rotated behind white card, rotation increases on hover). Marquee band rotated `rotate-1 scale-105`. Hero text at `text-[12vw]` with negative `space-y-[-3rem]`. Card hover floods with accent color.

---

## cloakclaw

**Vibe:** Dark hacker/DeFi infrastructure. Terminal aesthetics, menacing red glows, monospace labels with dramatic oversized headings. "Premium weaponized tool."

**Palette:**
- Background: `#050505` | Panel: `#0a0a0a` | Grid: `#1a1a1a`
- Accent: `#ff2a2a` | Accent deep: `#990000` | Accent light: `#ff7b7b`
- Code green: `#88ff88`
- Text: `#e5e5e5`

**Fonts:** `Space Grotesk` (display, 300-700) + `JetBrains Mono` (labels/code, 300-500)

**Signature CSS:**
```css
/* Glass panel */
.glass-panel {
  background: rgba(10, 10, 10, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* CRT scanline sweep */
.scan-line {
  position: absolute; left: 0; width: 100%; height: 20%;
  background: linear-gradient(to bottom, transparent, rgba(255, 42, 42, 0.1), transparent);
  animation: scan 3s linear infinite;
}

/* Technical corner brackets (HUD reticle) */
.technical-border::before {
  content: ''; position: absolute; top: -1px; left: -1px;
  width: 8px; height: 8px;
  border-top: 1px solid #ff2a2a; border-left: 1px solid #ff2a2a;
}
.technical-border::after {
  content: ''; position: absolute; bottom: -1px; right: -1px;
  width: 8px; height: 8px;
  border-bottom: 1px solid #ff2a2a; border-right: 1px solid #ff2a2a;
}

/* Grid background with radial mask */
.bg-tech-grid {
  background-size: 40px 40px;
  background-image:
    linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px);
  mask-image: radial-gradient(circle at 50% 0%, black 60%, transparent 100%);
}

/* Glow text */ text-shadow: 0 0 30px rgba(255, 42, 42, 0.6);
/* Glow box */ box-shadow: 0 0 20px rgba(255, 42, 42, 0.3);
/* Glow dot */ box-shadow: 0 0 10px #ff2a2a;

/* Marquee with edge fade */
.marquee-container {
  mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
}

/* Cursor blink */
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

/* Status badge */
<div class="px-3 py-1 rounded-full border border-[#ff2a2a]/30 bg-[#ff2a2a]/10 text-[#ff2a2a] text-[10px] font-mono tracking-widest uppercase">
```

**Key patterns:** Bento grid with mixed col/row spans at fixed `h-[600px]`. Glow blobs at `filter: blur(80px)`. Hover border shift `border-white/10` to `border-accent/50`. Tiny `text-[10px] font-mono uppercase tracking-widest` labels contrast with massive headings. Buttons: no border-radius, mono uppercase.

---

## pony-house

**Vibe:** Cinematic SaaS with Three.js floating island hero. Premium developer tooling lineage (Linear/Vercel) with unexpected 3D centerpiece. Dark, atmospheric.

**Palette:**
- bg: `#0B0C0E` | surface: `#15171B` | surfaceHighlight: `#1E2127`
- border: `rgba(255, 255, 255, 0.08)`
- accent: `#3B82F6` | accentGlow: `#2563EB`
- text: `#EAEAEA` | textDim: `#888888`

**Fonts:** `Inter` (300-700)

**Signature CSS:**
```css
/* Blur reveal entrance */
.reveal {
  opacity: 0; filter: blur(5px); transform: translateY(20px);
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.active { opacity: 1; filter: blur(0); transform: translateY(0); }

/* Text gradient */
.text-gradient-blue {
  background: linear-gradient(to right, #60a5fa, #3b82f6);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}

/* Dot grid */
background-image: radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px);
background-size: 20px 20px;

/* Glass morphism */
.glass {
  background: rgba(255, 255, 255, 0.02);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
```

**Key patterns:** Fixed hero + scroll spacer `400vh` for scroll-linked animations. Karaoke text (words illuminate on scroll). Tag chips: `text-[10px] border border-white/10 rounded-full`.

---

## stratum

**Vibe:** Industrial skeuomorphic control panel. Mixing consoles, analog dials, LED indicators. Obsessive layering of inset shadows, brushed metal textures, volumetric lighting on zinc palette with orange accent.

**Palette:**
- Scale: `#09090b` / `#121214` / `#18181b` / `#27272a` / `#3f3f46`
- Accent: `#f97316` (orange-500) | Signal: `#22c55e` (green) | `#ef4444` (red)

**Fonts:** `DM Sans` (display, 300-700) + monospace (technical labels)

**Signature CSS:**
```css
/* Master panel */
background: linear-gradient(135deg, #2a2a2e 0%, #121214 100%);
box-shadow:
  -16px -16px 40px rgba(63,63,70,0.04),
  32px 32px 80px rgba(0,0,0,0.9),
  inset 1px 1px 2px rgba(255,255,255,0.1),
  inset -1px -1px 4px rgba(0,0,0,0.8);

/* LED indicator */
box-shadow: 0 0 16px 2px #f97316, inset 0 1px 2px rgba(255,255,255,0.8), inset 0 -1px 2px rgba(0,0,0,0.6);

/* Brushed metal texture */
background-image: repeating-linear-gradient(90deg, #fff, #fff 1px, transparent 1px, transparent 4px);
opacity: 0.03; mix-blend-mode: screen;

/* Etched divider */
height: 1px; background: #09090b; box-shadow: 0 1px 0 rgba(255,255,255,0.06);

/* Card breathing */
@keyframes card-breath {
  0%, 100% { filter: brightness(1) saturate(1); }
  50% { filter: brightness(1.08) saturate(1.08); }
}
```

**Key patterns:** Fastener screws at card corners. Telemetry status bars full-width. Section headers with "MOD. 01 // CORE" mono labels + LED status.

---

## ux-jonny

**Vibe:** Swiss minimal portfolio. Monochromatic neutrals, generous whitespace, wireframe 3D hero. "Designer who codes" identity.

**Palette:**
- Background: `white` / `#fafafa` alternating
- Text: `#171717` / `#525252` / `#737373` / `#a3a3a3`
- Accents (badges only): blue-50/600, purple-50/600, emerald-50/600

**Fonts:** `Geist` (display/body, 300-700) + `Geist Mono` (labels/descriptions)

**Signature CSS:**
```css
/* Section header motif */
<div class="flex items-center gap-3 mb-6">
  <span class="text-xs font-bold text-neutral-400 uppercase tracking-widest font-geist-mono">Label</span>
  <div class="h-px flex-1 bg-neutral-200"></div>
</div>

/* Grayscale-to-color portrait */
img { filter: grayscale(1); } img:hover { filter: grayscale(0); transition: 700ms; }

/* Tech tag pill */
<span class="px-3 py-1 text-xs bg-neutral-100 text-neutral-600 border border-neutral-200 rounded-full font-geist-mono">React</span>
```

**Key patterns:** Sans for headings, mono for body/descriptions (inverted convention). No saturated color in the layout — neutrals only, colored badges as rare punctuation. Ping-animated availability dot.

---

## jalapao

**Vibe:** Raw, earthy adventure-tourism brutalism. Dark soil tones with rust-orange. Gritty textures, heavy type, desaturated imagery that pops to color on hover.

**Palette:**
```css
:root {
  --color-rust: #a63c06;
  --color-dirt: #2c2a26;
  --color-sand: #e8e6e1;
  --color-green: #3a4032;
}
```

**Fonts:** `Anton` (display, uppercase, `leading-[0.85]`) + `Manrope` (body) + `Permanent Marker` (handwritten accents)

**Signature CSS:**
```css
/* Noise texture overlay */
.noise-overlay {
  position: fixed; inset: 0; pointer-events: none; z-index: 50; opacity: 0.07;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* Brutalist box shadow on hover */
hover:shadow-[8px_8px_0px_0px_rgba(166,60,6,1)]

/* Clip-path diagonal section */
clip-path: polygon(0 0, 100% 0, 100% 10%, 0 100%)
```

**Key patterns:** Hero at `text-[10rem]`. Horizontal snap-scroll gallery. Sticky CTA bar `fixed bottom-6`. Handwritten labels with `rotate-2`.

---

## sunplanet

**Vibe:** Refined editorial luxury. Kinfolk magazine meets Aesop. Enormous whitespace, desaturated imagery, warm cream-and-yellow palette. Quiet confidence through restraint.

**Palette:**
- Background: `#FBF7EF` (warm cream) | Accent: `#FFE459` (yellow)
- Text: `#141414` (near-black) | Card bg: `#F2EDE4` (warm stone)

**Fonts:** `Instrument Serif` (display, italic + regular) + `Manrope` (body, 200-400)

**Signature CSS:**
```css
/* Desaturated-to-color with slow zoom */
img { filter: saturate(0); }
img:hover { filter: saturate(0.5); transform: scale(1.05); transition: 1000ms ease-out; }

/* Opacity as the ONLY modulation tool — all text is #141414 at varying opacities */
/* Labels: opacity-40 | Body: opacity-80 | Dividers: opacity-20 */

/* 1px hairline dividers */
<div class="w-full h-[1px] bg-[#141414] opacity-20"></div>

/* Ghost button → fill on hover */
<button class="px-8 py-4 border border-[#141414] hover:bg-[#141414] hover:text-[#FBF7EF] rounded-full transition-colors duration-300">

/* Dot grid texture */
background-image: radial-gradient(#141414 1px, transparent 1px);
background-size: 40px 40px; opacity: 0.1;
```

**Key patterns:** 12-col grid with 9/3 asymmetric hero split. Only 4 colors total. Floating nav with `mix-blend-mode: multiply`. `min-h-screen flex flex-col justify-end` pushes content to viewport bottom.

---

## rinkuu-gopalani

**Vibe:** Dark luxury editorial. High-end fashion magazine meets gallery website. Deep forest-green backdrop with dusty rose accents. Quiet sophistication through restraint and whitespace.

**Palette:**
- Background: `#2A332C` (forest green) | Dark: `#252C26` | Card: `#3A453C`
- Light section: `#F3F0EB` (parchment)
- Accent: `#D4A5A5` (dusty rose)
- Text on dark: `#F3F0EB` | Text on light: `#2A332C`

**Fonts:** `Cormorant Garamond` (headings, serif) + `Inter` (body, sans)

**Signature CSS:**
```css
/* Clip-path image wipe reveal */
.reveal-img { clip-path: inset(0 0 100% 0); transition: clip-path 1.2s cubic-bezier(0.77, 0, 0.175, 1); }
.reveal-img.active { clip-path: inset(0 0 0 0); }

/* Slide-up text reveal */
.reveal-text { opacity: 0; transform: translateY(30px); transition: all 1s cubic-bezier(0.16, 1, 0.3, 1); }
.reveal-text.active { opacity: 1; transform: translateY(0); }

/* Ambient glow blob */
<div class="absolute w-[500px] h-[500px] bg-[#D4A5A5] rounded-full mix-blend-multiply filter blur-[120px] opacity-10 animate-pulse"></div>

/* Status badge with pulse */
<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D4A5A5]/5 border border-[#D4A5A5]/10 text-[#D4A5A5] text-xs uppercase tracking-widest">
  <span class="w-1.5 h-1.5 rounded-full bg-[#D4A5A5] animate-pulse"></span>
  Label
</div>
```

**Key patterns:** Sticky sidebar scroll. Staggered masonry via `lg:mt-12` offset. Decorative giant numbers at `text-6xl opacity-10`. Serif headings at `leading-[0.9]` with `font-light`.

---

## nexus (multi-page)

**Vibe:** Cinematic dark-mode SaaS mission control. Glass surfaces over near-black backgrounds, film grain, particle networks, mouse-tracking spotlights. A full multi-page site (Index, Features, Solutions, Pricing, Company, Workflow, Careers, Sign In).

**Palette:**
- Body: `#050505` | Cards: `#0a0a0a`
- Border: `rgba(255, 255, 255, 0.08)` (the ONE border color used everywhere)
- Glass fill: `rgba(255, 255, 255, 0.03)`
- Accent: `#3b82f6` (blue-500) | `#60a5fa` (blue-400)
- Text: `#e5e5e5` body | `rgba(255,255,255,0.9)` headings | `rgba(255,255,255,0.40)` labels

**Fonts:** `Space Grotesk` (display) + `Inter` (body) + `Instrument Serif` (italic accent words)

**The triple-font heading formula:**
```html
<h2 class="text-4xl md:text-6xl font-display font-semibold tracking-tighter leading-[0.95]">
  Infrastructure that
  <span class="font-serif italic font-light tracking-normal text-white/60">scales</span>
</h2>
```

**Signature CSS:**
```css
/* Glass panel (universal building block) */
.glass-panel {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

/* Spotlight card (mouse-following radial highlight) */
.spotlight-card::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(600px circle at var(--mouse-x) var(--mouse-y),
    rgba(255, 255, 255, 0.08), transparent 40%);
  opacity: 0; transition: opacity 0.5s; pointer-events: none; z-index: 2;
}
.spotlight-card:hover::before { opacity: 1; }

/* Film grain overlay */
.bg-grain::after {
  content: ""; position: fixed; inset: -100%; width: 300%; height: 300%;
  background-image: url("https://upload.wikimedia.org/wikipedia/commons/7/76/Noise.png");
  opacity: 0.04; animation: grain 8s steps(10) infinite;
  pointer-events: none; z-index: 9998;
}

/* Section grid */
.section-grid {
  position: absolute; inset: 0; pointer-events: none; opacity: 0.22;
  background: linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(ellipse at 50% 30%, #000 35%, transparent 72%);
}

/* Soft card hover */
.soft-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); }
.soft-card:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.15); transform: translateY(-2px); }

/* Mono label convention (used EVERYWHERE) */
<span class="text-[10px] font-mono uppercase tracking-[0.22em] text-white/35">Step 01</span>
```

**Key patterns:** Multi-page consistent design system. Scroll-driven "door" hero. Canvas particle networks. Pricing with sliding beam indicator. Team cards in horizontal snap scroll at `aspect-[4/5]`. GSAP `cubic-bezier(0.16, 1, 0.3, 1)` is the signature easing.

**Read the full source files in `examples/nexus/` for the complete multi-page implementation.**
````

[VERIFY]
```bash
cat .claude/skills/frontend-design/references/example-catalog.md | head -5
```
Expected: File starts with `# Example Design Catalog`.

**File 2** — Write `.claude/skills/frontend-design/references/design-system-template.md`:

````markdown
# Design System Template

> Reference for Phase 2 extraction. Every design system produces exactly 3 files in `{app}/design-system/`.

## File 1: `tokens.css`

CSS custom properties organized by category. Single source of truth for all visual values.

```css
/* ============================================
   {DESIGN_NAME} Design Tokens
   Extracted from: {SOURCE_FILE}
   ============================================ */

/* -- Colors -- */
:root {
  --base: #____;           /* Page background */
  --card: #____;           /* Card / surface background */
  --ink: #____;            /* Primary text */
  --accent: #____;         /* Primary accent color */
  --accent-light: #____;   /* Accent hover / lighter variant */
  --border: #____;         /* Default border */
  --border-hover: #____;   /* Border on hover / focus */

  /* Status */
  --green: #____;
  --red: #____;
  --amber: #____;
}

/* -- Spacing Scale -- */
:root {
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px;
}

/* -- Radii -- */
:root {
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;
}

/* -- Typography -- */
:root {
  --font-display: '____', sans-serif;
  --font-body: '____', sans-serif;
  --font-mono: '____', monospace;

  --text-xs: 9px;   --text-sm: 10px;  --text-base: 12px; --text-md: 14px;
  --text-lg: 16px;  --text-xl: 20px;  --text-2xl: 24px;  --text-3xl: 28px;
  --text-4xl: 32px; --text-5xl: 48px;

  --weight-regular: 400; --weight-medium: 500;
  --weight-semibold: 600; --weight-bold: 700;

  --tracking-tight: -0.02em; --tracking-normal: 0;
  --tracking-wide: 0.04em; --tracking-wider: 0.12em; --tracking-widest: 0.18em;
}

/* -- Transitions -- */
:root {
  --ease-default: 0.15s ease;
  --ease-spring: 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
```

## File 2: `components.css`

Reusable component classes extracted from the prototype. Each class is self-contained.

```css
/* ============================================
   {DESIGN_NAME} Components
   Requires: tokens.css loaded first
   ============================================ */

/* List every reusable visual pattern as a class:
   .{name}-card      — Primary card/container
   .section-header   — Section title with decorative element
   .metric-number    — Large display numbers
   .mono-label       — Small uppercase labels
   .trend-up/down    — Status badges
   .btn-primary      — Primary button
   .btn-secondary    — Ghost button

   Include hover states, transitions, pseudo-elements, animation keyframes.
*/
```

## File 3: `DESIGN.md`

Human/AI-readable specification. Read this first, then use the CSS files.

```markdown
# {Design Name} — Design System

> Extracted from `{source_file}` on {date}

## Font Stack

| Role | Family | CDN |
|------|--------|-----|
| Display | {name} | `{cdn_url}` |
| Body | {name} | `{cdn_url}` |
| Mono | {name} | `{cdn_url}` |

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| `--base` | #____ | Page background |
| `--card` | #____ | Card surfaces |

## Component Inventory

| Class | Description | Usage |
|-------|-------------|-------|
| `.{name}-card` | Primary card with border + hover | Metric cards, containers |

## Design Rules

### DO
- {Rule 1}

### DON'T
- {Rule 1}

## Iconography

{Icon library, default size, color tokens}
```

---

## Extraction Checklist

- [ ] Every CSS variable from the prototype's `:root` is in `tokens.css`
- [ ] Every repeated visual pattern has a class in `components.css`
- [ ] Font CDN URLs are documented in `DESIGN.md`
- [ ] Color palette table is complete
- [ ] Component inventory lists every class with a one-line description
- [ ] Do/Don't rules capture the design's distinctive constraints
- [ ] Animation keyframes included if the prototype uses entrance animations
````

[VERIFY]
```bash
ls .claude/skills/frontend-design/references/
```
Expected: Both `example-catalog.md` and `design-system-template.md` listed.

### Step 4: Install the design example library

These are the HTML files Claude reads before building any design. They need to be copied from this module folder into the skill folder in the workspace.

First, ask the user: "Where did you extract this module? Give me the full path to the `aios-module-frontend-design` folder (e.g. `/Users/yourname/Downloads/aios-module-frontend-design`)."

Once you have the path, run:

```bash
# Replace MODULE_PATH with the actual path the user gave you
MODULE_PATH="/path/to/aios-module-frontend-design"

cp "$MODULE_PATH/examples/"*.html .claude/skills/frontend-design/examples/
cp "$MODULE_PATH/examples/nexus/"* .claude/skills/frontend-design/examples/nexus/
```

If you're doing a CUSTOM install (specific examples only), copy just the ones chosen during scoping.

If the user isn't sure of the path, help them find it:
- Mac: the file is probably in `~/Downloads/aios-module-frontend-design` — run `ls ~/Downloads/aios-module-frontend-design/examples/` to check
- If they extracted it into their workspace: use `ls aios-module-frontend-design/examples/` from the workspace root

[VERIFY]
```bash
ls .claude/skills/frontend-design/examples/
```
Expected: 8 HTML files listed, plus a `nexus/` folder (if included).

---

## TEST

This module doesn't need API calls or scripts. The test is using it.

### Quick verification

```bash
ls .claude/skills/frontend-design/SKILL.md \
   .claude/skills/frontend-design/references/example-catalog.md \
   .claude/skills/frontend-design/references/design-system-template.md \
   && echo "Skill installed correctly!"
```
Expected: All files listed, ending with "Skill installed correctly!"

### Live test

Ask the user: "Let's do a quick test. Think of something you're building — even something simple like a dashboard or a landing page for a side project. Tell me a sentence or two about what it is."

Once they describe it, say:

> "I'm going to build you a quick HTML mockup. I'll pick a visual style from the example library that fits what you're building, and you'll get a working HTML file you can open in your browser. This is exactly what you'd do before building a real app — get the look locked in first."

Then run the skill:
1. Read `references/example-catalog.md`
2. Pick 2 examples that best match the described app
3. Read both full HTML source files from `examples/`
4. Build a focused single-page mockup (hero + 1-2 sections is enough for a test)
5. Output a single `.html` file

If the output opens in a browser and looks polished: "That's the skill working. Every time you start building something new, this is your first step."

---

## WHAT'S NEXT

You now have a design step in your toolkit. Here's how it fits into the full workflow:

**If you have /new-app installed:**
1. Start `/new-app` — work through Phase 1 (scope your app: name, purpose, screens, data)
2. When asked about UI references or design direction, pause and run this skill
3. Describe your app, get an HTML mockup
4. Take that `.html` file back to `/new-app`: "Here are my designs. Continue from where we left off."
5. `/new-app` will extract a full design system from your mockup and build the implementation plan

**If you're building without /new-app:**
- Just say "design my [thing]" or describe what you need — the skill auto-triggers
- Once you have a mockup you're happy with, say "lock this in" and it will extract a design system for you

**Get /new-app if you don't have it yet:**
- The `/new-app` module is the companion to this one — it takes your designs and turns them into a phased, production-ready build plan
- Available at [aaaaccelerator.com](https://aaaaccelerator.com)

---

> A plug-and-play module from Liam Ottley's AAA Accelerator — the #1 AI business launch
> & AIOS program. Grab this and 15+ more at [aaaaccelerator.com](https://aaaaccelerator.com)
