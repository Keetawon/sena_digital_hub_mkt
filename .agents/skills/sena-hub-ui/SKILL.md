---
name: sena-hub-ui
description: >
  SENA Digital Hub admin UI system: Next.js 16 / React 19 in apps/admin,
  Tailwind v4 layered over styles/tokens.css, the SENA Development palette
  with measured light/dark roles, Google Sans + Noto Sans Thai for Thai-only
  users, the service shell, and minimal motion with prefers-reduced-motion. Use
  for any apps/admin screen, component, style, font or animation work,
  including the ads registry screens and the assistant side panel. Pair with
  ui-ux-pro-max for general UX rules.
---

# SENA Hub admin UI

App: `apps/admin` (Next.js 16.4.3, React 19.3.0). **Read `apps/admin/AGENTS.md` first**: this
Next.js has breaking changes, so check `node_modules/next/dist/docs/` before using an API.
All users are Thai. Every label, error, empty state and toast is Thai; codes and IDs stay as-is.

## Tailwind v4 over tokens.css

- Tailwind v4 (`tailwindcss` + `@tailwindcss/postcss`), CSS-first config: no `tailwind.config.js`.
- `styles/tokens.css` stays the single source of values. Map with `@theme inline { --color-…: var(--…) }`
  so Tailwind utilities and existing plain-CSS components read the same variables.
- Migrate screen by screen. Existing `*.css` component files keep working, so don't bulk-rewrite them.
- Components use semantic tokens (`bg-surface`, `text-ink`, `bg-action`), never raw hex.

## SENA Development palette and shell

Docs/47 §§3.1 and 8.1 are authoritative for the unified content workspace. Copy
Thai labels exactly from that UTF-8 document; never retype them. Docs/22 §1.3
records the current token values and measured pairs. Earlier Flip7 and luxury
green/gold guidance is historical.

| Token | Light | Dark | Use |
|---|---|---|---|
| canvas | `#F2F8F7` | `#0A211F` | App background |
| surface | `#FFFFFF` | `#102C29` | Cards, forms; text on action fills |
| surface-warm | `#E4F1EF` | `#1A3C38` | Context panels |
| ink | `#10312E` | `#EFFAF8` | Body text |
| muted | `#43645F` | `#B1CEC8` | Supporting and disabled text |
| action | `#08786E` | `#88D0C8` | Buttons, links, focus |
| primary-strong | `#075B54` | `#B0E8E0` | Action hover |
| line-strong | `#668781` | `#7FABA5` | Essential control boundaries |
| sidebar / active | `#0B3835` / `#15534F` | Same | Service navigation |
| sidebar-ink / muted | `#F4FCFB` / `#B8D9D5` | Same | Navigation text |
| gold-light | `#B0E8E0` | Same | Compatibility name: aqua selection/focus |

- System dark mode is supported through `prefers-color-scheme`. Keep existing semantic token aliases.
- Primary buttons and selected tabs use `surface` text on `action`; do not pair pale dark-mode
  actions with white/sidebar text. Keep the distinct status-soft/strong pairs.
- The supplied full SENA logo sits on a white plate in both themes; the 64px rail uses the mark.
  The logo links home; the separate 44px collapse/expand button appears beside it on rail hover/focus.
- Navigation is data-driven service → groups → items. Hide empty services, retain a service
  disclosure even for one permitted item, and keep the permission route inventory separate.
- Labels stay on one line with ellipsis and full-text tooltips on hover/focus. Keep 44px targets,
  visible focus, instant collapse, saved state and native mobile/tablet dialog behavior.
- Questions and accounts remain bottom utilities. The assistant uses its floating opener,
  never a sidebar item or disabled H1 paragraph. Search entry is specified in docs/47 W2.
- Validate 1280px, 1024px and 390px in local and disposable H1, light/dark, keyboard and reduced
  motion. Save success screenshots under `artifacts/unified-workspace/w1/` for the W1 gate.

Every new pairing needs a measured ratio in docs/22 before use: at least 4.5:1 for text and
3:1 for essential UI boundaries in every supported theme. Use unrounded results; text does
not pass by rounding. Recheck hover, focus, selected and disabled states. Status always
includes text or an icon.

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
