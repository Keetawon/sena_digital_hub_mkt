# 22 — Hub assistant and UI

Updated: 30 September 2026 (Asia/Bangkok). Status: **P1 implemented locally; current theme: Emerald & Champagne (§1.3); human Thai readability acceptance pending**.
This slice covers the SENA-H registry list, registration wizard and agency ID-return
inbox. [Doc 19 §5.1](19-campaign-naming-registry.md#51-registry-schema-sena-h-implemented-in-p1)
owns identity, permissions and issuing. [The priority plan](ads/PHASE1_PRIORITIES.md)
owns sequencing. P1.0 itself changed documentation only. The owner has now authorized
P1.1–P1.5, approved an Online-supplied per-boost corporate LABEL, and confirmed that
agencies see only their own names and return IDs only.

## 1. Theme tokens → Tailwind v4

**Current visual direction:** the owner's luxury green-and-gold request supersedes the
Flip7 palette. §1.3 defines the current values and measured contrast. The original
Flip7 table and §1.1–1.2 remain historical implementation evidence.

`apps/admin/styles/tokens.css` remains the value source. P1.1 adds `tailwindcss` v4,
`@tailwindcss/postcss` and `motion`; no Tailwind JavaScript configuration or new component
library. Use top-level `@theme inline` aliases so utility classes resolve existing CSS
variables. The Flip7 mapping below was the first P1 implementation, replacing the
previous InsightDeck values. Existing token names remain
defined and existing component CSS stays in place.

| Value token in tokens.css | Value | Tailwind theme alias | Use / compatibility |
|---|---|---|---|
| `--canvas` | `#EFF8F7` | `--color-canvas` | App background |
| `--surface` | `#FFFFFF` | `--color-surface` | Table/card/input; `--sidebar` keeps its surface alias |
| `--surface-warm` | `#FFF8E7` | `--color-surface-warm` | Pending panel; `--surface-soft` aliases this |
| `--ink` | `#0F172A` | `--color-ink` | Retained dark text; also text on brand/gold/coral |
| `--muted` | `#475569` | `--color-muted` | Supporting text; `--read-only` remains the same |
| `--brand` | `#2BA8A2` | `--color-brand` | Large decorative/header areas, dark text; `--primary` aliases this |
| `--action` | `#177A75` | `--color-action` | Primary buttons, underlined links and focus; `--primary-action` and `--focus` alias this |
| `--primary-strong` | `#115E59` | `--color-action-hover` | Retained primary hover shade, white text |
| `--gold` | `#FFD23F` | `--color-gold` | Highlight badge with ink text |
| `--coral` | `#EF6C4A` | `--color-coral` | Attention fill with ink text |
| `--coral-strong` | `#B8442A` | `--color-danger` | Destructive button / error text; `--danger` aliases this |
| `--success-strong` | `#047857` | `--color-success` | Retained success text, with status wording/icon |
| `--warning-strong` | `#92400E` | `--color-warning` | Retained warning text on warm panel |
| `--line-strong` | `#64748B` | `--color-line-strong` | Input edges, not supporting text on canvas |
| `--line` | existing `#E2E8F0` | `--color-line` | Decorative row dividers only; not the sole input boundary |

Keep remaining `--primary-*`, `--secondary-*`, `--tertiary-*`, `--art-*`, status-soft/line,
brand-ink/accent, shadow and scrim names working for existing screens. The Hub integration
in §1.2 remaps the compatibility aliases to Flip7; semantic status values remain distinct.
P1.1 keeps existing component CSS. Tailwind Preflight can affect existing controls/table
borders: the existing Playwright suite is included in the verification run.

Implemented mapping pattern (the remaining aliases follow the table):

```css
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-surface-warm: var(--surface-warm);
  --color-ink: var(--ink);
  --color-action: var(--action);
  --font-sans: var(--font-ui);
}
```

The Flip7 source is the [owner-selected design reference](https://designmd.ai/yiujc/flip7-card-game)
and the repository's sena-hub-ui palette. The dark action/semantic colors are Hub
accessibility choices. Aliasing follows [Tailwind's theme-variable documentation](https://tailwindcss.com/docs/theme).

### 1.1 Measured contrast, 29 September 2026

Computed with Python's standard library from the hex pairs below, **not copied from
the skill's claimed ratios**. For sRGB channel `c = byte/255`, linearize as
`c/12.92` if `c <= 0.04045`, otherwise `((c+0.055)/1.055)^2.4`.
`L = 0.2126R + 0.7152G + 0.0722B`; ratio = `(L_lighter+0.05)/(L_darker+0.05)`.
Decisions use the unrounded value; displayed values use four decimal places.
Normal text needs 4.5:1, qualifying large text and essential UI edges need 3:1.
See [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

| Foreground | Background | Measured ratio | Registry decision |
|---|---|---:|---|
| `#0F172A` ink | `#FFFFFF` surface | 17.8525:1 | Body/table text passes |
| `#0F172A` ink | `#EFF8F7` canvas | 16.5265:1 | Body text passes |
| `#0F172A` ink | `#FFF8E7` warm | 16.8603:1 | Pending panel text passes |
| `#475569` muted | `#FFFFFF` surface | 7.5777:1 | Supporting text passes |
| `#475569` muted | `#EFF8F7` canvas | 7.0148:1 | Supporting text passes |
| `#475569` muted | `#FFF8E7` warm | 7.1565:1 | Supporting text passes |
| `#0F172A` ink | `#2BA8A2` brand | 6.1425:1 | Header text passes |
| `#FFFFFF` white | `#2BA8A2` brand | 2.9064:1 | Reject even for large text |
| `#FFFFFF` white | `#177A75` action | 5.1507:1 | Button text passes; inverse link on surface also passes |
| `#177A75` action | `#EFF8F7` canvas | 4.7681:1 | Links/focus pass |
| `#177A75` action | `#FFF8E7` warm | 4.8644:1 | Links/focus pass |
| `#FFFFFF` white | `#115E59` hover | 7.5835:1 | Hover button text passes |
| `#0F172A` ink | `#FFD23F` gold | 12.3628:1 | Badge text passes |
| `#0F172A` ink | `#EF6C4A` coral | 5.8778:1 | Attention badge text passes |
| `#FFFFFF` white | `#EF6C4A` coral | 3.0373:1 | Reject normal button text |
| `#FFFFFF` white | `#B8442A` coral-strong | 5.3869:1 | Destructive button text passes |
| `#B8442A` error | `#EFF8F7` canvas | 4.9868:1 | Error text passes |
| `#047857` success | `#FFFFFF` surface | 5.4839:1 | Success text passes |
| `#047857` success | `#EFF8F7` canvas | 5.0766:1 | Success text passes |
| `#92400E` warning | `#FFF8E7` warm | 6.6960:1 | Warning text passes |
| `#64748B` line-strong | `#FFFFFF` surface | 4.7588:1 | Input edge passes |
| `#64748B` line-strong | `#EFF8F7` canvas | 4.4054:1 | Edge passes; normal text fails |
| `#64748B` line-strong | `#FFF8E7` warm | 4.4944:1 | Edge passes; normal text fails (do not round to 4.5) |
| `#177A75` action | `#FFD23F` gold | 3.5668:1 | Edge only; use ink for text |
| `#177A75` action | `#EF6C4A` coral | 1.6958:1 | Reject focus directly on coral |

Use a visible 2px action outline with a 2px white offset/gap around controls so the
focus indicator is adjacent to a measured surface even on a colored panel. Hover,
disabled and selected states must retain readable text; do not reduce whole-control
opacity. Status always includes Thai text and, where useful, a simple SVG icon.
New pairings, alpha overlays and changed token values require recomputation.

Reproduce any row using `python -B -` with this body, substituting the listed hex pair:

```python
def luminance(value):
    c = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in c]
    return sum(v * w for v, w in zip(c, (.2126, .7152, .0722)))

a, b = sorted(map(luminance, ("#FFFFFF", "#177A75")))
print(f"{(b + .05) / (a + .05):.4f}:1")
# Actual output: 5.1507:1
```

### 1.2 Shared Hub navigation and theme, 30 September 2026

The owner requested the naming registry in the Digital Hub menu and the registry's
theme, fonts and motion throughout the existing Hub. This is an authorized P1 UI
integration; it adds no P2–P5 workflows or financial features.

`HubShell` supplies one main navigation, header, skip link, main landmark and footer
for projects, brands and all three registry screens. The registry link now sits inside
`เมนูหลัก` alongside the two residential sections. The selected section remains marked
on detail/wizard/inbox pages. Registry subnavigation uses `รายการชื่อแคมเปญ`,
`ส่งคืนรหัสแคมเปญ` and the existing role-gated `ลงทะเบียนแคมเปญ` link. On small screens
the menu wraps above the content, with no horizontal scrolling or fixed text heights.

Navigation retains the caller's role. Entering the registry with a residential account
still shows the explicit Online/agency test-account choices, and its API access remains
denied. The existing local role selectors, dirty-form guards, registry approval banner
and agency restrictions keep their behavior.

Existing CSS uses compatibility aliases rather than a second palette:

| Alias group | Mapping |
|---|---|
| primary soft / hover soft / line | warm / canvas / line-strong |
| secondary / strong / soft / hover soft / line | action / ink / warm / warm / line |
| tertiary / strong / soft / line | ink / ink / gold / gold |
| art background / surface / line | brand / warm / line-strong |

Shared controls use dark teal primary actions, ink secondary text, visible line-strong
boundaries and 8px corners; panels use 12px corners. The local-test banner and selected
navigation use warm surfaces. Gold accents always use ink text. Disabled buttons retain
legible text instead of reducing the whole button's opacity. Brand wordmark colors and
semantic success/warning/error/info tokens remain distinct.

All these text pairs already appear in §1.1 except the two compatibility combinations
below. Recomputed using the same sRGB formula with Python on 30 September 2026:

| Foreground | Background | Measured ratio | Use |
|---|---|---:|---|
| `#115E59` primary-strong | `#FFF8E7` warm | 7.1620:1 | Existing section labels on warm panels |
| `#115E59` primary-strong | `#EFF8F7` canvas | 7.0202:1 | Existing dark-teal labels on canvas |

The root already loads Google Sans Thai and the self-hosted Noto fallback; no second
font loader is added. Headings and controls share Google Sans across both modules.
Dense residential source/snapshot lists, model specifications and facts now use the
same Noto-first 15px/1.6 stack as registry tables. The human readability protocol in §2
remains open.

### 1.3 Emerald & Champagne — luxury green and gold, 30 September 2026

Owner-requested color design for the existing Hub. Deep emerald anchors navigation
and project artwork; ivory keeps tables and forms comfortable for sustained work.
Brushed brass adds thin rules, selected-menu markers and small accents. Champagne
surfaces highlight context. Solid colors keep contrast predictable; no metallic text,
shimmer, background photography or transparency behind data is needed.

| Token | Value | Role |
|---|---|---|
| canvas | `#F6F3EB` | Ivory workspace |
| surface | `#FFFEFA` | Porcelain cards, forms, tables |
| surface-warm | `#EFE8D8` | Champagne table headers and contextual panels |
| ink | `#14291F` | Deep green body text |
| muted / read-only | `#53645A` | Supporting text |
| sidebar | `#102D23` | Deep emerald navigation |
| sidebar-active | `#214536` | Selected/hovered navigation and artwork medallions |
| sidebar-ink | `#F6F1E4` | Ivory navigation text |
| sidebar-muted | `#C1CEBC` | Supporting navigation text |
| sidebar-line | `#49614B` | Decorative navigation separator |
| brand | `#214D39` | Forest-green project artwork; use light foregrounds |
| action / primary-strong | `#18523D` / `#103A2C` | Primary action / hover |
| gold | `#BDA36B` | Brushed-brass fills and decorative rules; ink text on fills |
| gold-light | `#D8C28D` | Gold text and focus on dark green |
| gold-strong | `#7A622A` | Gold labels/indicators on light surfaces |
| line / line-strong | `#DCD6C7` / `#788477` | Decorative separators / control boundaries |
| success-strong | `#0F6444` | Status text, darkened for champagne backgrounds |
| coral-strong / danger | `#A43B27` | Error text and destructive actions |

Compatibility aliases from §1.2 continue to work. Artwork's surface now maps to
sidebar-active and its decorative line to gold; its icon and label use gold-light.
The wordmark uses ivory and gold on the sidebar. Navigation focus uses gold-light
with a sidebar-colored gap; ordinary control focus remains dark green with a porcelain
gap. Gold never replaces readable text or becomes the sole status indicator.

Typography, sizes, spacing, menu structure, registration behavior and reduced-motion
rules are retained. Existing Google Sans Thai headings and Noto Thai data typography
carry the same appearance through every screen. Motion follows the Apple-inspired language in §3: brief, springy and never blocking.

Measured with the sRGB formula in §1.1 before applying the palette. Ratios below are
computed, not copied from a palette reference; text requires 4.5:1 and UI edges 3:1.

| Foreground | Background | Measured ratio | Decision |
|---|---|---:|---|
| `#14291F` ink | `#FFFEFA` surface | 15.2258:1 | Body text |
| `#14291F` ink | `#F6F3EB` canvas | 13.8570:1 | Body text |
| `#14291F` ink | `#EFE8D8` warm | 12.5882:1 | Panel/table text |
| `#53645A` muted | `#FFFEFA` surface | 6.2334:1 | Supporting text |
| `#53645A` muted | `#F6F3EB` canvas | 5.6731:1 | Supporting text |
| `#53645A` muted | `#EFE8D8` warm | 5.1536:1 | Supporting/disabled text |
| `#FFFEFA` surface | `#18523D` action | 8.9961:1 | Button text; inverse pair also passes |
| `#FFFEFA` surface | `#103A2C` hover | 12.5083:1 | Hover button text |
| `#18523D` action | `#F6F3EB` canvas | 8.1873:1 | Links/focus |
| `#18523D` action | `#EFE8D8` warm | 7.4377:1 | Links/focus |
| `#214D39` brand | `#FFFEFA` surface | 9.5223:1 | Existing facility control accent |
| `#214D39` brand | `#F6F3EB` canvas | 8.6663:1 | Existing facility focus |
| `#214D39` brand | `#EFE8D8` warm | 7.8728:1 | Selected facility control edge |
| `#103A2C` primary-strong | `#F6F3EB` canvas | 11.3838:1 | Existing section labels |
| `#103A2C` primary-strong | `#EFE8D8` warm | 10.3415:1 | Existing section labels |
| `#F6F1E4` sidebar-ink | `#102D23` sidebar | 13.0981:1 | Navigation text |
| `#F6F1E4` sidebar-ink | `#214536` active | 9.4562:1 | Hover navigation text |
| `#C1CEBC` sidebar-muted | `#102D23` sidebar | 9.0192:1 | Sidebar supporting text |
| `#D8C28D` gold-light | `#102D23` sidebar | 8.4557:1 | Gold labels/focus |
| `#D8C28D` gold-light | `#214536` active | 6.1046:1 | Selected navigation/artwork text |
| `#D8C28D` gold-light | `#214D39` brand | 5.5009:1 | Artwork foreground |
| `#7A622A` gold-strong | `#FFFEFA` surface | 5.7675:1 | Gold text/indicators |
| `#7A622A` gold-strong | `#F6F3EB` canvas | 5.2490:1 | Gold text/indicators |
| `#7A622A` gold-strong | `#EFE8D8` warm | 4.7684:1 | Gold text/indicators |
| `#14291F` ink | `#BDA36B` gold | 6.3034:1 | Gold badge/step text |
| `#14291F` ink | `#EF6C4A` coral | 5.0589:1 | Retained attention-fill text |
| `#788477` line-strong | `#FFFEFA` surface | 3.8783:1 | Control edge only |
| `#788477` line-strong | `#F6F3EB` canvas | 3.5297:1 | Control edge only |
| `#788477` line-strong | `#EFE8D8` warm | 3.2065:1 | Control edge only |
| `#A43B27` danger | `#FFFEFA` surface | 6.4357:1 | Error text; inverse button pair passes |
| `#A43B27` danger | `#F6F3EB` canvas | 5.8572:1 | Error text |
| `#A43B27` danger | `#EFE8D8` warm | 5.3209:1 | Error text |
| `#A43B27` danger | `#FEF2F2` danger-soft | 5.9372:1 | Existing error panels |
| `#0F6444` success | `#FFFEFA` surface | 7.1102:1 | Success text |
| `#0F6444` success | `#F6F3EB` canvas | 6.4710:1 | Success text |
| `#0F6444` success | `#EFE8D8` warm | 5.8785:1 | Success text |
| `#0F6444` success | `#ECFDF5` success-soft | 6.8116:1 | Existing success badges |
| `#92400E` warning | `#EFE8D8` warm | 5.8086:1 | Retained warning text |
| `#1D4ED8` info | `#EFE8D8` warm | 5.4903:1 | Retained info text |
| `#BDA36B` gold | `#FFFEFA` surface | 2.4155:1 | Reject for text/essential edges; decoration only |
| `#BDA36B` gold | `#214536` active | 4.3749:1 | Reject normal text; use gold-light |
| `#18523D` action | `#102D23` sidebar | 1.6271:1 | Reject sidebar focus; use gold-light |

The earlier danger/success shades measured 4.4132:1 and 4.4927:1 on champagne and
were darkened as above. Semantic status backgrounds and wording remain distinct.
ui-ux-pro-max's luxury/premium palette search supports restrained gold accents on
neutral surfaces; its generic marketing hero, glass and Latin font suggestions do
not fit this Thai administration interface and are not applied.

## 2. Google Sans Thai and dense-table readability

Inspected installed Next.js 16.3.5's `next/dist/compiled/@next/font/dist/google/index.d.ts`:
`Google_Sans` includes `thai` and `latin`; `Google_Sans_Flex` does not include Thai.
The [Google Fonts metadata](https://raw.githubusercontent.com/google/fonts/main/ofl/googlesans/METADATA.pb)
also lists Thai. This verifies the API/metadata, not browser loading or user readability.

P1.1 loads `Google_Sans` via `next/font/google` with `subsets: ["thai", "latin"]`,
`display: "swap"`, normal variable weight and `variable: "--font-google-sans"`.
The existing `next/font/local` loader for `app/fonts/NotoSansThai-Variable.ttf`
is retained and both generated variable classes apply to `<html lang="th">`.
`--font-ui` resolves to Google Sans → the generated Noto Sans Thai family → Leelawadee UI
→ Tahoma → sans-serif. Use the generated family variables, not just literal display
names; avoid an automatic Latin-only fallback taking precedence over Noto for Thai.
`--font-table` selects Noto first without changing headings, pending human readability review.

Next.js emits a build warning that Google Sans has no automatic fallback metric override.
The explicit Noto fallback remains configured (`adjustFontFallback: false` for Google
Sans). This warning is recorded; it is not evidence of a failed Thai font download.
Browser rendered-font and blocked-Google fallback evidence is recorded with P1 verification.

Next/font obtains Google font files during build and serves them locally; browser
verification should find same-origin `/_next/static/media/...` font requests, not
require a runtime Google CDN call. Check generated CSS Unicode ranges, loaded Thai
glyphs and DevTools rendered-font evidence on actual Thai cells, plus a failed-font
fallback run. Build-time network availability is still required; report failure
honestly and retain Noto if downloading cannot be completed. Do not claim the requested
Google font is installed simply because fallback text is readable.
[Next.js font reference](https://nextjs.org/docs/app/api-reference/components/font).

Retain current sizes: `--text-small = .9375rem` (15px at a 16px root), body
`1.0625rem` (17px), label `1rem`; Thai line-height ≥1.5, table body preferably 1.6.
Never use the 14px caption size for dense table values or primary instructions.
No fixed-height clipping of Thai tone marks, forced letter spacing or uppercasing
of source text. Codes use literal ASCII; wrapping must not alter clipboard values.

Readability protocol, to perform with the P1.4 screens:

1. Prepare the same 20–30 registry rows with approved Thai project/agency display names,
   similar spellings, long labels, combining marks, `00412`, `000006`, and SN codes.
   Use synthetic native IDs; no leads/customer data. Vary long and short values.
2. Compare Google Sans and Noto table bodies at 15px/1.6, normal and 200% zoom,
   375/768/1440px widths. Inspect tone marks, wrapping, visible focus and row scanning.
3. At least one Online staff user and one agency user each find five specified rows,
   distinguish similar labels, read/copy a code, and return an ID. Counterbalance font
   order; record completion time, selection/transcription errors and preference.
4. Accept only with no clipped Thai marks or ID transcription errors; investigate any
   repeated wrong-row selection or materially slower scanning (proposed trigger: >10%
   median time increase versus Noto). UX owner signs the result. This is a small usability
   check, not a statistically validated claim.
5. If loopless reading is worse, keep Google Sans headings and use Noto for table bodies.
   Until Thai reviewers are available, Noto-first table bodies are the default; font
   implementation can continue, but readability acceptance remains pending.

## 3. Hub motion and interaction spec

**Owner request, 1 October 2026:** replace the quiet P1.1 motion with an Apple-inspired
language that makes page changes, loading, input and responses feel physical and
responsive. The tokens and rules live in `apps/admin/styles/motion.css` (imported after
`globals.css`); the shared primitives stay in `components/registry-motion.tsx`.

Principles: motion explains what happened and where things came from; it never delays
data or blocks input. Only opacity, transform and a brief entrance blur animate; table
cells, widths and heights never do, and text is never stretched by a non-uniform scale.
Springs replace linear timing (CSS `linear()` samples of damping 0.8 and 0.62, with cubic
fallbacks). Durations: press 110ms, quick 180ms, base 320ms, entrance 460ms, spring
≈520ms; list stagger 38ms, capped after seven items.

| Moment | Motion | Focus, URL and reduced-motion behavior |
|---|---|---|
| Page change between workspaces | Cross-document View Transition: the old page dims, shrinks to 98.5% and blurs out in 200ms; the shell cross-fades; the new page's sections rise 12px out of a 6px blur, staggered | Plain links keep full navigation, URLs and history. Browsers without the API navigate instantly. Reduced motion: no transition and no entrance. |
| Data arriving | Rows, cards and metrics rise 8px and fade in one after another; the active sidebar item settles with a small spring | Data is rendered as soon as it arrives; the animation never postpones it. Reduced motion: instant. |
| Loading | iOS-style petal activity indicator beside the existing Thai loading text; shimmering skeleton rows (decorative, `aria-hidden`) while a list has no rows yet; full-page loading text fades in only after 150ms to avoid flicker | The live-region text is unchanged. Reduced motion: the indicator ticks slowly and the shimmer stops. |
| Input focus | The 3px focus ring settles from 7px away onto the field with a soft halo | Ring width and colour are unchanged; forced-colours mode keeps the native outline. Reduced motion: instant ring. |
| Invalid input / rejected step | Fields with `aria-invalid="true"` shake briefly; error summaries drop in, then shake once | Focus still moves to the error summary as before. Reduced motion: no shake. |
| Busy action | Buttons with `aria-busy="true"` show the activity indicator and a light sweep while saving | Label text (`กำลังบันทึก…`) stays; buttons remain disabled while busy. |
| Success response | Success notices pop with a spring and draw their check; keyed status text re-pops on every new message inside a stable live region | Announcements are unchanged. Reduced motion: instant. |
| Buttons and cards | Press scales to 96% quickly and springs back; primary buttons gain a soft glow on hover; cards lift 3px with a spring | Hover effects only on hover-capable devices; no transforms with reduced motion. |
| Registry list → detail card | The card grows out of its source row with a uniform spring scale (no stretched text) above a frosted backdrop; a direct link rises 18px into place | Focus moves to the card heading; Esc/Back/close restore the opener as before. Reduced motion: instant card, 80ms backdrop fade. |
| Cascading picker (`DropdownPop`) | Drops 6px from the trigger and scales from 95% on a spring; closes in 120ms | Keyboard behavior unchanged. Reduced motion: opacity only. |
| Residential dialogs, tabs and disclosures | Dialogs rise 18px like a sheet (translate only, so control sizes never scale) above a frosted backdrop; tab panels and opened `<details>` content rise 8px | Native dialog focus/Esc and form guards unchanged. Reduced motion: instant. |

The frosted backdrop blur is static; only its opacity animates. Motion is not an
accessibility manager: native dialog, focus and URL handling remain as specified below.

Proposed list URL: `/ads/registry?registration=SN2600101Y&tab=names`, retaining
search/filter/page on close. A direct link loads the permitted detail without needing
the source row mounted; fade without a morph in that case. Browser Back closes detail;
Forward reopens. Refresh does not lose the selected tab. A denied/missing record shows
`ไม่พบรายการที่มีสิทธิ์เข้าถึง`, without revealing another agency's registration.
Shared layout IDs are scoped per screen/code to avoid collisions. Native dialog/focus
features may be reused; Motion is not an accessibility manager.

## 4. Wireframes and screen behavior

All human-facing labels, help, loading, empty, error and toast text are Thai. Codes,
IDs, platform names and UTM parameter keys remain literal. Dates explicitly use
Asia/Bangkok; examples below use Gregorian dates with Thai month wording. Numeric IDs
use text inputs, never numeric coercion. Touch targets ≥44×44px and ≥8px spacing.
At 375px, stack filters and render each record as a labelled summary card; do not
shrink Thai text or create page-wide horizontal overflow. Detail wraps long names and
provides exact copy. Keep semantic table headings on desktop.

### 4.1 Registry list and detail

```text
+--------------------------------------------------------------------+
| ทะเบียนชื่อแคมเปญ                              [ลงทะเบียนแคมเปญ]    |
| รออนุมัติรูปแบบชื่อ                                                  |
| [ค้นหาชื่อหรือรหัส........] [เอเจนซี: ทั้งหมด v] [สถานะ: ทั้งหมด v]    |
| รหัส          โครงการ/ขอบเขต        วัตถุประสงค์  เอเจนซี   สถานะ     |
| SN2600101Y    โคซี่ สะพานใหม่       LEADS         KIN       รอรับรหัส  |
| SN2600102F    เฟล็กซี่ สาทร เฟส 2   LEADS         BRANDSTROM ผูกแล้ว   |
| [ก่อนหน้า]                    หน้า 1                     [ถัดไป]    |
+--------------------------------------------------------------------+
        +---------------------------------------------------------+
        | โคซี่ สะพานใหม่ / SN2600101Y                       [ปิด] |
        | [รายละเอียด] [ชื่อและลิงก์ติดตาม] [รหัสบนแพลตฟอร์ม]     |
        | กลุ่ม: C-COZI-BTSSM / เอเจนซี: KIN                       |
        | ออกชื่อ: 29 ก.ย. 2026 เวลา 14:30 (เวลาประเทศไทย)         |
        | ชื่อที่ออกแล้ว: [ข้อความเต็มที่คัดลอกได้]                 |
        | [คัดลอกชื่อ] [คัดลอกชุดข้อมูลสำหรับเปิดแคมเปญ]            |
        +---------------------------------------------------------+
```

`ลงทะเบียนแคมเปญ` is for online_staff/admin. Agency view shows only its own records
and a fixed agency label, not an all-agency picker. Counts/search/pagination come from
authorized server rows. Status text: `รอรับรหัส`, `ผูกรหัสแล้ว`, `ยกเลิกแล้ว` (derived
binding state plus registration status). Show exact members for multi-phase/shared
scope, including no-invented-allocation wording. Common states: `กำลังโหลดข้อมูล…`,
`ยังไม่มีรายการลงทะเบียน`, `ไม่พบรายการตามตัวกรอง`, `โหลดข้อมูลไม่สำเร็จ` + `ลองอีกครั้ง`.

### 4.2 Three-step registration wizard

The wizard has three **screens**; screen 1 contains the three cascading **scope-picker
choices** from doc 19. These are different step counts, explained in Thai.

```text
+--------------------------------------------------------------------+
| ลงทะเบียนแคมเปญ                                                    |
| รออนุมัติรูปแบบชื่อ                                                  |
| [1 ขอบเขตโฆษณา] --- [2 รายละเอียดแคมเปญ] --- [3 ตรวจสอบและออกชื่อ]   |
|                                                                    |
| 1 ขอบเขตโฆษณา                                                      |
| ประเภทขอบเขต [C หลายเฟสในกลุ่มเดียวกัน v]                           |
| กลุ่มโครงการ  [C-FLEX-STCRN / เฟล็กซี่ สาทร v]                      |
| เฟส          [x] HYABC   [x] HY2DE   [ ] ...                         |
| เลือกอย่างน้อย 2 เฟสที่ไม่ซ้ำกัน                                    |
|                                             [ยกเลิก] [ถัดไป]       |
|--------------------------------------------------------------------|
| 2 รายละเอียดแคมเปญ                                                 |
| วัตถุประสงค์ [LEADS / เก็บรายชื่อผู้สนใจ v]                          |
| เอเจนซี       [BRANDSTROM v]                                        |
| รูปแบบย่อย    [KW-BRAND / คำค้นชื่อแบรนด์ v]                          |
| ชื่อแสดงภาษาอังกฤษ: FLEXI SATHON (จากทะเบียนขอบเขต)                 |
| ตัวอย่างชื่อ: FLEXI SATHON__LEADS__C-FLEX-STCRN__BRANDSTROM__         |
|              [รหัสจะออกเมื่อบันทึก]__KW-BRAND                       |
| ตัวอย่างนี้ยังใช้เปิดแคมเปญไม่ได้                     [ย้อนกลับ] [ถัดไป] |
|--------------------------------------------------------------------|
| 3 ตรวจสอบและออกชื่อ                                                 |
| ขอบเขต C / C-FLEX-STCRN / HYABC, HY2DE                              |
| LEADS / BRANDSTROM / KW-BRAND                                       |
| ชื่อที่ออกแล้วแก้ไขไม่ได้                                           |
| การออกชื่อไม่ได้อนุมัติงบประมาณ                                     |
|                          [ย้อนกลับ] [บันทึกและออกชื่อ]              |
+--------------------------------------------------------------------+
```

Each change sends structured selections to the server preview endpoint (debounce
~250ms, discard stale responses). Never concatenate a name in the client, allocate SN
for preview, allow typed scope tokens, or offer preview copy. Invalid/missing English
labels show `กรุณาติดต่อ SENA Idea เพื่อยืนยันชื่อภาษาอังกฤษ`. C/D duplicate selection
cannot satisfy minimum membership; inactive/proposed values are disabled with reasons.
For CORP only, step 2 asks `ชื่อชิ้นงานภาษาอังกฤษที่อนุมัติแล้ว` and requires Online to
confirm `ยืนยันว่าชื่อชิ้นงานนี้ได้รับอนุมัติแล้ว`. The server validates uppercase ASCII,
the 40-character limit and the assertion before issue; other scope labels stay read-only.
On invalid submit, preserve inputs, show linked inline errors and focus a Thai error
summary. On uncertain save/network outcome, show `ยังยืนยันการบันทึกไม่ได้ กรุณาตรวจรายการล่าสุดก่อนลองอีกครั้ง`.

After successful commit, step 3 becomes the saved result (not a fourth step):

```text
+--------------------------------------------------------------------+
| ออกชื่อเรียบร้อยแล้ว: SN2600103W                                    |
| ชื่อ: FLEXI SATHON__LEADS__C-FLEX-STCRN__BRANDSTROM__SN2600103W__KW-BRAND |
| [คัดลอกชื่อ]                                                       |
| utm_campaign: [ชื่อเต็มเดียวกับด้านบน]            [คัดลอกค่า]        |
| utm_id: ใช้รหัสแคมเปญจากแพลตฟอร์ม ไม่ใช่ SN2600103W                |
| สำหรับ GOOGLE: utm_id={campaignid}                                 |
| [คัดลอก UTM สำหรับ GOOGLE]                                         |
| [คัดลอกชุดข้อมูลสำหรับเปิดแคมเปญ] [เปิดรายละเอียด]                   |
+--------------------------------------------------------------------+
```

Server returns the exact name, raw utm_campaign, encoded platform suffix and launch-pack
text. Buttons copy those bytes, with `คัดลอกแล้ว` only after clipboard success. On
denial show selectable text plus `คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วคัดลอก`.
Full pack includes name + utm_campaign + Thai utm_id note and Google macro, never
budget/memo data in P1. The macro identifies the Google campaign; capture through
redirects/forms remains a separate Q8 go-live dependency.
[Google ValueTrack reference](https://support.google.com/google-ads/answer/6305348?hl=en).

When sena_h_approved=false, the banner **รออนุมัติรูปแบบชื่อ** appears on all screens.
In a configured test environment, issuing/copying test results remains available with
`ข้อมูลทดสอบ ห้ามใช้เปิดแคมเปญจริง`. In production, disable issue/variant actions and
explain the pending decision; the API independently rejects them. Existing permitted
history remains readable. Failed/missing settings never imply approval.

### 4.3 Agency ID-return inbox

```text
+--------------------------------------------------------------------+
| ส่งคืนรหัสแคมเปญ                             เอเจนซี: KIN           |
| รออนุมัติรูปแบบชื่อ                                                  |
| [รอรับรหัส] [ส่งรหัสแล้ว]                 [ค้นหารหัสหรือชื่อ.....]   |
| SN2600101Y | โคซี่ สะพานใหม่ | LEADS | [กรอกรหัสแพลตฟอร์ม]          |
|--------------------------------------------------------------------|
| ส่งรหัสสำหรับ SN2600101Y                                      [ปิด] |
| ชื่อที่ออกแล้ว [เลือกชื่อ/รูปแบบย่อย v] [คัดลอกชื่อ]                 |
| แพลตฟอร์ม       [GOOGLE v]                                         |
| รหัสบัญชีโฆษณา  [................]                                 |
| รหัสแคมเปญ      [................]                                 |
| เก็บรหัสตามต้นทาง รวมเลขศูนย์นำหน้า                                 |
| ส่งรหัสได้หลายแคมเปญต่อหนึ่งชื่อ                                   |
|                                [ยกเลิก] [บันทึกรหัส]               |
+--------------------------------------------------------------------+
```

Agency is fixed by authentication; online_staff/admin can filter across agencies for
follow-up. Returning one ID does not close the registration to further IDs. Success:
`บันทึกรหัสแล้ว`; exact replay: `รหัสนี้บันทึกไว้แล้ว`. A conflict shows `รหัสนี้ผูกกับรายการอื่นแล้ว กรุณาติดต่อ SENA Idea`
without exposing another agency's registration. The user can retain/copy entered IDs
but cannot override the conflict. No automated account ownership claim or DW-confirmed
delivery badge follows from a manual return. Changing/cancelling an issued identity is
not hidden in this form.

## 5. UX evidence and verification plan

Applied ui-ux-pro-max local searches: `keyboard focus modal` returned Focus States;
`error summary validation` returned Focusable Error Summary. The design-system search
returned a relevant Data-Dense Dashboard style but an irrelevant Enterprise Gateway
marketing layout; a narrowed `data table dashboard --domain style` verified the
dashboard match. Keep the useful focus, error, filter and density guidance; reject its
12–14px Thai table suggestion and alternate palette/fonts in favor of the explicit Hub
requirements. No generated design-system files were persisted.

P1.1 must preserve existing Playwright behavior. P1.4 adds registry list/wizard/inbox
coverage: two agencies and direct URL/API isolation, inactive/C/D selection, server
preview without sequence consumption, successful/exact clipboard, conflict and multiple
ID returns, keyboard focus/Esc/Back/Forward, 375px/200% zoom, Thai errors, and a
`prefers-reduced-motion: reduce` run. Inspect representative screens visually. Record
actual command results; P1.0's contrast calculation is not a UI/build/test-suite pass.

### 5.1 Implementation evidence, 29 September 2026

Local access follow-up: a residential account retained by the shared local-session
cookie previously reached a generic registry 403/retry message. The registry now
explains the current account's purpose and offers explicit Online/agency test-account
buttons before requesting registry data. No account changes automatically; the API
continues to reject residential roles. This applies to list, wizard and inbox entry.
The focused registry regression command `npm.cmd run test:ui -- tests/ui/ads-registry.spec.ts`
passed **6 tests (25.6s)** after the fix, including residential → registry → explicit
Online switching and unchanged agency isolation. Typecheck/build passed; the existing
Google Sans metric warning remains. The recovery panel was also checked at 375px.
The full-run results below record the preceding P1 verification, not a new full-suite run.

The final full Playwright run passed **50 tests**, including all 45 existing tests and
five registry tests. Registry coverage includes server preview and exact clipboard API
input, same-SN variant append, agency isolation, multiple leading-zero native IDs,
replay/conflict handling, C cardinality, ordinary row/card motion after a list refresh,
deep links, keyboard focus, Escape/Back/Forward, unsaved-input confirmation and reduced
motion at 375px with a 200% root-text-size run. Browser clipboard readback on Windows
normalizes LF to CRLF; the test checks the exact original `writeText` argument and
normalizes only readback line endings. Single-line name copy remains an exact comparison.

The first browser run exposed a direct-link shared-layout collision. Direct links now
omit the row's shared layout ID; a row click uses the shared layout ID as designed.
The final run passed after that fix. Browser evidence and complete command output are
linked from [the P1 implementation report](ads/P1_IMPLEMENTATION_20260929.md).

Actual Chromium rendered-font inspection found **Google Sans 18pt** for the Thai registry
heading and **Noto Sans Thai** for a Thai table cell. With Google `.woff2` requests
blocked, the heading rendered using **Noto Sans Thai**. Requested font files returned
HTTP 200 from the same-origin `/_next/static/media/` path. Screenshots of list, detail,
wizard, inbox, narrow layout and fallback were inspected after motion settled; no clipped
Thai marks were observed in these samples. The narrow 200% text-size check found no
horizontal document overflow. This is engineering evidence, not the timed Online/agency
readability study in §2; that human check remains open. Native browser zoom has not been
claimed tested by the root-text-size run.

Recomputed all 25 contrast rows against the installed palette. Typecheck and production
build pass; the Google Sans automatic-metric warning above remains. Registry pages use
the existing local-session proxy for local testing. The API supports verified production
JWT role/agency claims, but connecting a production browser sign-in/session remains a
deployment prerequisite; local demo role selection is never enabled outside local mode.

### 5.2 Shared Hub integration verification, 30 September 2026

Actual commands on the updated local production build:

| Command | Result |
|---|---|
| `npm.cmd run typecheck --prefix apps/admin` | Exit 0; `tsc --noEmit` |
| `npm.cmd run build --prefix apps/admin` | Exit 0; compiled successfully; existing Google Sans automatic-metric warning remains |
| `npm.cmd run test:ui -- tests/ui/hub-navigation.spec.ts tests/ui/ads-registry.spec.ts` | `9 passed (29.9s)` |
| `npm.cmd run test:ui` | `54 passed (2.2m)` |

The three new navigation tests cover all main sections and registry subpages, selected
menu state, explicit role preservation, keyboard links, and 375px with 200% root text
size and reduced motion. Existing tests still cover issuing, agency isolation, dialog
focus, dirty forms, media uploads, publishing and rollback. No API/database source
changed, and backend/database test suites were not rerun for this UI-only integration.

Inspected desktop project list, project detail, registry list and mobile registry
screenshots. Browser measurements found no horizontal overflow in these samples and
no runtime errors in the project-list/registry checks. Chromium rendered-font evidence
shows Google Sans 18pt for both Thai page headings and Noto Sans Thai at 15px for an
expanded residential source-data label. The first source-font probe targeted collapsed
content and returned no glyphs; the recorded Noto result is from the visible label.
Human readability acceptance is still pending; the automated 200% check changes root
text size and does not claim native browser zoom coverage.

The local web server was restarted with the updated build. No Supabase migration,
deployment, commit or push was performed as part of this UI integration.

### 5.3 Luxury palette verification, 30 September 2026

After applying §1.3, typecheck and production build both exited 0. The existing Google
Sans automatic-metric warning remains; the explicit Thai font setup is unchanged.
`npm.cmd run test:ui -- tests/ui/hub-navigation.spec.ts tests/ui/ads-registry.spec.ts`
returned **`9 passed (29.8s)`**, including mobile 200% text, reduced motion, role
preservation, agency isolation and the registration flows. The full 54-test result in
§5.2 predates this color change; it was not rerun for the palette-only follow-up.

Browser-computed text/background checks sampled 29 pairs across projects, registry
and wizard; all exceeded 4.5:1, with a minimum of **4.7684:1**. Keyboard focus in the
sidebar renders a solid 2px gold-light outline. Registry widths 1440, 768 and 375px had
no horizontal document overflow, and the completed browser smoke check reported zero
runtime errors. Desktop project, registry, wizard and mobile registry screenshots were
visually inspected. These are sampled engineering checks, not a full accessibility audit.

The local production server now serves the Emerald & Champagne design. The change is
limited to palette tokens, shared/sidebar styling, registry accents and this document;
earlier uncommitted navigation changes are preserved. Nothing was committed or pushed.

## 6. Assistant — TODO (owner P5)

Headed placeholder only. Design tools, panel, citations, streaming and Thai evaluation
in P5; no assistant API, prompt or component is authorized in P1.

## 7. Media lines and memo register — approved P2 contract (owner P2)

**30 September 2026: expanded P2.0 approved for implementation.** The owner's reply
was `P2.0 approved — implement expanded P2`. The data, permissions, API and acceptance
contract is [doc 23](23-media-lines-and-memo-register.md), expanded by
[doc 24](24-card-costs-and-recurring-commitments.md). Reuse the current Emerald &
Champagne semantic tokens (§1.3), Google Sans headings and Noto Sans Thai dense tables
(§2); implement P2 screens without changing the existing palette or font contract.

| Screen | Proposed Thai controls and behavior |
|---|---|
| Memo register — `ทะเบียน Memo` | Search `เลข Memo`; show BUD, gross and mirrored status. `บันทึก Memo` opens the staff form; `ยืนยันข้อมูลที่บันทึก` confirms transcription. Clearly state `Hub บันทึกสถานะจาก E-memo ไม่ได้อนุมัติ Memo`; no memo-approval button or file upload. |
| Monthly lines — `รายการงบรายเดือน` | Visible filters `เดือน`, `เอเจนซี`, `BUD`, `ขอบเขต`; retain filter state in the URL. Distinguish current applicable revisions, pending revisions and unresolved evidence with Thai text, not color alone. Group totals and phase children must not appear as additive budgets; show full-period program budgets separately. |
| Line detail — `รายละเอียดรายการงบ` | Row-to-card detail with `ภาพรวม`, `เฟสและ Memo`, `ชื่อแคมเปญที่เชื่อม`, `รุ่นและประวัติ`. `เชื่อมชื่อแคมเปญ` requires explicit staff selection, then `ยืนยันการเชื่อม` for the SN, month and target revision. Suggestions are labelled `รายการที่แนะนำ`; ambiguous matches remain unassigned. |
| Registration detail — `รายการงบรายเดือน` | Staff-only financial context on the existing SN detail: month, assigned line, memo reference and applicable revision. `ยังไม่เชื่อม` offers `เลือกรายการงบ`; preserve every issued name and the pending SENA-H approval banner. |
| Corrections queue — `รายการแก้ไขรหัส` | Show observed code, month range, agency, per-month target and review status. Staff use `เสนอการแก้ไข`; only admin may use `อนุมัติการแก้ไขรหัส` after reviewing evidence. This approves a crosswalk, never a memo. `นำรายการที่เลือกไปใช้` requires a separate explicit action; proposals never apply automatically. |

Only `online_staff` and `admin` receive these financial screens and fields. Agencies
retain their own P1 names and ID-return flow; they receive no lines, amounts, memos,
approver names, evidence, corrections or financial counts through UI or API.

Reuse §3 row/card, backdrop, tab and dropdown timing. Cards have stable deep links
containing IDs and safe filter values only; opening moves focus inside, Esc/close/Back
restores the opener, and dirty forms retain the existing confirmation guard. Reduced
motion removes transforms and shared-layout morphs; data renders immediately. Forms
have visible Thai labels, inline errors and a focused error summary. Status, loading,
empty and permission states are Thai; codes stay verbatim, months follow Asia/Bangkok,
and dense tables retain the Thai readability and mobile checks in §§2 and 5.

### 7.1 Account registries, commitments and card-cost review — expanded P2.0

The latest card-paid addendum replaces the earlier one. These screens are included in
the explicitly approved expanded P2 implementation; financial access remains staff-only.
Reuse the tokens, fonts, focus behavior, deep
links and reduced-motion rules above. Source account IDs use text inputs, remain
verbatim and retain leading zeros; dates and monthly coverage follow Asia/Bangkok.

| Screen | Proposed Thai controls and behavior |
|---|---|
| Ad-account registry — `ทะเบียนบัญชีโฆษณา` | Search platform/account ID; show `ขอบเขต`, `BUD`, `เอเจนซี`, `เริ่มใช้`, `สิ้นสุด`. `กฎแบ่ง BUD` shows each reviewed share, effective dates and an exact-sum preview; unresolved mappings show `รอยืนยันการจับคู่`. Descriptor evidence alone must not silently change a verified mapping. |
| Channel-account registry — `ทะเบียนบัญชีช่องทาง` | LINE OA account/project or scope, `แพ็กเกจ`, `ยอดที่คาดต่อครั้ง` and validity dates. Explain `รายการในใบแจ้งยอดอาจระบุบัญชี OA ไม่ได้`; the shared descriptor is not an account identifier. No inferred project assignment. |
| Commitments — `ภาระค่าใช้จ่ายประจำ` | Vendor/account, scope/BUD, plan, `รายเดือน` / `รายปี`, amount per cycle, payment method, start/end, memo coverage and cap. State `ไม่ใช่แคมเปญ จึงไม่มีชื่อ SENA-H หรือรหัส SN`. Detail separates `ยอดชำระ`, `ต้นทุนรับรู้รายเดือน` and `วงเงินที่อนุมัติ`; annual prepaid coverage shows all covered months and the exact-total remainder explicitly. |
| Memo identity — `เลข Memo และชื่ออ้างอิง` | Keep one canonical number and separately reviewed aliases with evidence. A proposed alias that differs in serial shows `เลขลำดับต่างกัน ต้องตรวจสอบเอกสาร`; do not auto-merge `M.COM037/69` with `M.COM033_69`. Alias approval is identity review, never memo approval. |
| Card-sheet import — `นำเข้าค่าใช้จ่ายบัตรบริษัท` | A trusted operator validates the sanitized CSV/manifest and explicitly applies it through the local CLI in [P2 import format](ads/P2_IMPORT_FORMAT.md). The browser reviews the resulting receipt, source/tab/row provenance, exact-header profile and Thai issues. Summary displays source total, statement control and difference. Staff explicitly confirm or replace eligible reviewed batches; quarantined conflicts require review. The CLI reports harmless replay. No browser upload/apply control or source-sheet write is provided. |
| Cost review — `ตรวจสอบรายการค่าใช้จ่าย` | Explicit `ประเภทต้นทุน` and `วิธีชำระเงิน` selectors drive `เอกสารประกอบที่ต้องใช้`. Show pending Finance acceptance of the requirement matrix. Use Thai display labels while retaining stored codes: MEDIA/AGENCY_FEE/CHANNEL/TOOL/BANK_FEE and CORPORATE_CARD/AGENCY_PO_INVOICE/PLATFORM_INVOICE/BANK_TRANSFER. Account, BUD, memo and commitment matches require evidence; no forced SN field for subscriptions. |

Cost labels: `MEDIA` = `สื่อโฆษณา`, `AGENCY_FEE` = `ค่าบริการเอเจนซี`, `CHANNEL` =
`ช่องทาง`, `TOOL` = `เครื่องมือ`, `BANK_FEE` = `ค่าธรรมเนียมธนาคาร`. Payment labels:
`CORPORATE_CARD` = `บัตรบริษัท`, `AGENCY_PO_INVOICE` = `ใบสั่งซื้อและใบแจ้งหนี้เอเจนซี`,
`PLATFORM_INVOICE` = `ใบแจ้งหนี้แพลตฟอร์ม`, `BANK_TRANSFER` = `โอนเงินธนาคาร`.

Amounts and statuses must remain understandable without color. Tables display cash,
monthly recognition and budgets in separate labelled columns/cards and never one
combined "spend" total. Confirmation distinguishes accepting source transcription
from approving a memo, budget or payment. Imports use a focused error summary and
row-level errors with safe source coordinates; discarded card digits/PII never appear
in previews, toasts, URLs or diagnostics. No statement PDF upload or OCR button is
part of P2. Q21 must establish any Media-to-`online_staff` role mapping before real
access is provisioned; agencies receive none of these screens or amounts.

### 7.2 Card-statement review — design boundary only (owner P4)

Future flow: `อัปโหลดใบแจ้งยอด` → `รอตรวจสอบข้อความ` → `ตรวจสอบยอดรวม` →
`ทีมมีเดียยืนยันรายการ` → `จัดประเภทตามกฎ`. A scanned five-page statement needs OCR;
extracted rows are DRAFT until totals and Media confirmation pass. The LINE OA review
groups eligible charges by `วันที่เรียกเก็บ` and `จำนวนเงิน`, compares actual and
expected counts, and explains `จำนวนตรงกัน` or `จำนวนไม่ตรง ต้องตรวจสอบ`.
Automated reconciliation waits for accepted per-account evidence under Q20 and
[doc 21](21-ememo-archive-and-search.md); matching counts alone is insufficient.
An approved later rule may treat identical rows as interchangeable only after its
evidence/eligibility/count checks. Row order never implies account identity.
Cash amounts come from validated rows.

Implementation belongs to the P4 document pipeline. Statements remain restricted to
marketing-ops roles, never appear in any RAG search/assistant document index, and
external OCR/LLM processing waits for Q7. File access, confirmation authority and
retention are not inferred from the user's ability to see a P2 cost row.

## 8. Line actuals, exceptions and document tracking — P3.0 design (owner P3)

The authorized design is [doc 25](25-line-actuals-and-exceptions.md), pending
`P3.0 approved` before implementation. It covers Thai line actuals, C5/C6 workflow
and the imported document-reference matrix with a copy-only follow-up log. Budget,
platform media, card cash and monthly allocations stay distinct. P2 agency denial
remains the default; any separately approved own-spend view excludes budgets/memos.
Reuse §3's motion tokens/primitives, focus/deep-link behavior and reduced motion;
do not add screen-specific keyframes or animate values to suggest fresh data.

## 9. E-memo archive, statement review and search — P4.0 design (owner P4)

The authorized design is [doc 21](21-ememo-archive-and-search.md), pending
`P4.0 approved` and completion of P3. It covers private archive/review screens for
two document types and a permission-filtered, sanitized memo search with page/version
citations. Statements never enter any RAG namespace. Transcription confirmation and
P2 financial-batch confirmation are separate actions; neither approves E-memo itself.

Use §3's existing motion tokens and primitives for list/detail cards, page tabs,
dropdowns, loading and reduced motion. Preserve focus, Esc/Back and deep links.
Keep amounts/count checks immediately readable; no custom animation or new timing.
Thai errors link to affected rows/pages, and dense tables follow §§2 and 5.
Q7 precedes real uploads/external processing; Q20 gates LINE OA reconciliation;
Q21/Q30 define reviewers and Q29 defines retention. Search permission alone never
grants statement access or external-processing permission.

## 10. Other ads screens — TODO (outside P1)

P2–P5 own their respective screens above. Remaining financial flows and additional
redesign belong to separately scheduled P6. The owner-requested shared navigation/theme
integration in §1.2 is limited to existing Hub screens and the P1 naming registry.
