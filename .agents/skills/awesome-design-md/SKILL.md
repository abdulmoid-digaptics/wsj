---
name: awesome-design-md
description: "Curated collection of 84+ production brand DESIGN.md specifications (Apple, Stripe, Vercel, Linear, Notion, Claude, Figma, Airbnb, Tesla, and more). Use when designing or styling pages, components, or entire design systems matching iconic brand visual languages, color tokens, typography scales, layout rules, and component patterns."
---

# Awesome DESIGN.md - Brand Design Systems for AI

This skill provides access to 84+ complete, reverse-engineered brand design systems adhering to the `DESIGN.md` format (originally introduced with Google Stitch). Each design file specifies typography, color palettes, spacing scales, surface depths, component states, and design guardrails extracted from production web applications.

## How to Use

When the user asks to adopt or replicate the design style of a specific brand or service:

1. **Locate the Brand's DESIGN.md**:
   Find the specification in `references/design-md/<brand>/DESIGN.md`.
2. **Apply to the Project**:
   Copy the specification into the project root as `DESIGN.md`, or reference its design tokens and component guidelines directly when generating UI code.
3. **Prompting the Agent**:
   Instruct the model to follow the tokens, scales, and anti-patterns defined in `DESIGN.md`.

---

## Catalog by Industry

### AI & LLM Platforms
- **Claude** (`references/design-md/claude/DESIGN.md`) - Warm terracotta accent, clean editorial layout, serif display type.
- **Cohere** (`references/design-md/cohere/DESIGN.md`) - Vibrant enterprise gradients, technical dark theme.
- **ElevenLabs** (`references/design-md/elevenlabs/DESIGN.md`) - Dark cinematic UI, audio-waveform aesthetics.
- **Mistral AI** (`references/design-md/mistral.ai/DESIGN.md`) - French-engineered minimalism, purple accents.
- **Ollama** (`references/design-md/ollama/DESIGN.md`) - Monochrome, terminal-first simplicity.
- **Runway** (`references/design-md/runwayml/DESIGN.md`) - Editorial film-festival aesthetic, cinematic dark heroes, paper-white bands.
- **VoltAgent** (`references/design-md/voltagent/DESIGN.md`) - Void-black canvas, emerald accent, terminal-native.
- **xAI** (`references/design-md/x.ai/DESIGN.md`) - Stark monochrome, futuristic minimalism.

### Developer Tools & Productivity
- **Vercel** (`references/design-md/vercel/DESIGN.md`) - Black and white precision, Geist font, crisp 1px borders.
- **Linear** (`references/design-md/linear.app/DESIGN.md`) - Ultra-minimal, precise, keyboard-first, signature purple accents.
- **Cursor** (`references/design-md/cursor/DESIGN.md`) - Sleek dark IDE aesthetic, subtle glowing borders.
- **Raycast** (`references/design-md/raycast/DESIGN.md`) - Dark macOS chrome, vibrant gradient accents.
- **Supabase** (`references/design-md/supabase/DESIGN.md`) - Dark emerald theme, developer-first code blocks.
- **Notion** (`references/design-md/notion/DESIGN.md`) - Warm minimalism, serif headings, soft surfaces.
- **Resend** (`references/design-md/resend/DESIGN.md`) - Clean monochrome dark theme, monospace accents.
- **Warp** (`references/design-md/warp/DESIGN.md`) - Dark block-based terminal layout.

### Fintech & Crypto
- **Stripe** (`references/design-md/stripe/DESIGN.md`) - Signature luminous gradients, weight-300 typography, elevated white cards.
- **Coinbase** (`references/design-md/coinbase/DESIGN.md`) - Clean blue identity, institutional trust, crisp data layouts.
- **Mercury** (`references/design-md/mercury/DESIGN.md`) - Startup banking, ink-violet night surfaces, indigo pill actions.
- **Revolut** (`references/design-md/revolut/DESIGN.md`) - Sleek fintech cards, high-contrast dark UI.
- **Wise** (`references/design-md/wise/DESIGN.md`) - High-visibility brand green, friendly clarity.

### Consumer Tech, Retail & Media
- **Apple** (`references/design-md/apple/DESIGN.md`) - Generous white space, SF Pro typography, cinematic imagery.
- **Airbnb** (`references/design-md/airbnb/DESIGN.md`) - Warm coral accent, card-based search feeds, soft rounded corners.
- **Figma** (`references/design-md/figma/DESIGN.md`) - Playful multi-color accents, canvas-first tool aesthetic.
- **Nike** (`references/design-md/nike/DESIGN.md`) - Bold uppercase typography, high-impact photography, sharp monochrome.
- **Spotify** (`references/design-md/spotify/DESIGN.md`) - Iconic green-on-black, album-card grids.
- **Tesla** (`references/design-md/tesla/DESIGN.md`) - Radical subtraction, full-viewport photography, Universal Sans.

---

## Section Structure in Each File
Every `DESIGN.md` includes:
1. **Visual Theme & Atmosphere**: Mood, density, design philosophy.
2. **Color Palette & Roles**: Semantic hex codes and background/foreground roles.
3. **Typography Rules**: Font families, sizing, line-heights, and weights.
4. **Component Stylings**: Buttons, inputs, cards, badges, and modals.
5. **Layout & Spacing**: Grid systems and whitespace scales.
6. **Depth & Elevation**: Layering and shadow systems.
7. **Do's and Don'ts**: Anti-patterns and strict constraints.
