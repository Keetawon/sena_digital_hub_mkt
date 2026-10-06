---
name: sena-hub-ui
description: >
  SENA Digital Hub admin UI system: Next.js 16 / React 19 in apps/admin,
  Tailwind v4 layered over styles/tokens.css, the Flip7 palette with
  contrast-checked roles, Google Sans + Noto Sans Thai for Thai-only users,
  and the Motion (motion/react) spec (row→card shared-layout morph, backdrop
  fade, tabbed card expand, dropdown pop) with prefers-reduced-motion. Use
  for any apps/admin screen, component, style, font or animation work,
  including the ads registry screens and the assistant side panel. Pair with
  ui-ux-pro-max for general UX rules.
---

# SENA Hub admin UI

App: `apps/admin` (Next.js 16.3.5, React 19.3.0). **Read `apps/admin/AGENTS.md` first**: this
Next.js has breaking changes, so check `node_modules/next/dist/docs/` before using an API.
All users are Thai. Every label, error, empty state and toast is Thai; codes and IDs stay as-is.

## Tailwind v4 over tokens.css

- Tailwind v4 (`tailwindcss` + `@tailwindcss/postcss`), CSS-first config: no `tailwind.config.js`.
- `styles/tokens.css` stays the single source of values. Map with `@theme inline { --color-…: var(--…) }`
  so Tailwind utilities and existing plain-CSS components read the same variables.
- Migrate screen by screen. Existing `*.css` component files keep working, so don't bulk-rewrite them.
- Components use semantic tokens (`bg-surface`, `text-ink`, `bg-action`), never raw hex.

## Flip7 palette (source: designmd.ai/yiujc/flip7-card-game)

| Token | Hex | Use | Text on it |
|---|---|---|---|
| canvas | `#EFF8F7` | app background | ink |
| surface | `#FFFFFF` | cards, tables, panels | ink |
| surface-warm | `#FFF8E7` | highlighted panels, empty states | ink |
| brand | `#2BA8A2` | **large areas only** (header band, illustrations); never small text or buttons | ink (dark) |
| action | `#177A75` | primary buttons, links, focus ring | white (5.15:1) |
| gold | `#FFD23F` | badges, highlights | dark ink only |
| coral | `#EF6C4A` | attention fills | dark ink only |
| coral-strong | `#B8442A` | destructive/alert buttons | white |
| success / error | darker shades for text | status text | on white/canvas |

Every new pair needs a measured contrast ratio (≥4.5:1 text, ≥3:1 large text/UI edges) in the
design doc's contrast table before use. Status is never color-only; pair it with an icon or text.

## Fonts

- `"Google Sans"` via `next/font/google` with `subsets: ["thai", "latin"]` (Google Sans has a Thai
  subset; **Google Sans Flex does not**, so don't use Flex). Fallback chain: Google Sans → Noto Sans Thai
  (already self-hosted at `app/fonts/NotoSansThai-Variable.ttf`) → Leelawadee UI → Tahoma.
- Verify the Thai subset actually loads (network panel) before switching the default.
- Readability check: Google Sans Thai is loopless. Test dense tables (ledger/line lists at
  `--text-small`) with real Thai data and Thai users. If loopless hurts scanning, use looped Noto Sans
  Thai for table bodies and Google Sans for headings. Keep body ≥ 15px and line-height ≥ 1.5 for Thai.

## Motion (owner decision, 7 October 2026)

- No shared-layout IDs, row-to-card morphs, springs, scale, or animations on lists, tables, dashboards and cards.
- Only dialogs, dropdowns/popovers and tab panels may use opacity/translate transitions, at most 150 ms. Use the shared `styles/motion.css`; no per-screen timing.
- `prefers-reduced-motion: reduce` disables all transitions immediately, including loading decoration. Loading uses static placeholders and live status text.
- Preserve native dialog focus containment, Escape, opener focus restoration, dirty guards and deep links. Render content and controls immediately.
- Verify a production build (`next build` + `next start`) with normal and reduced motion. The current contract supersedes earlier animated navigation and page-transition guidance.

## Screen checklist

Keyboard reachable · visible focus (`action` ring) · Thai labels on every control (no placeholder-only
labels) · loading/empty/error states in Thai · agencies never see other agencies' rows · a Playwright
spec under `tests/ui/` per new screen (pattern: existing `*.spec.ts`).
