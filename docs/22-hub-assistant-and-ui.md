# 22 — Hub assistant and UI

Date: 29 September 2026 (Asia/Bangkok). Status: **P1 implemented and verified locally; human Thai readability acceptance pending**.
This slice covers the SENA-H registry list, registration wizard and agency ID-return
inbox. [Doc 19 §5.1](19-campaign-naming-registry.md#51-registry-schema-sena-h-implemented-in-p1)
owns identity, permissions and issuing. [The priority plan](ads/PHASE1_PRIORITIES.md)
owns sequencing. P1.0 itself changed documentation only. The owner has now authorized
P1.1–P1.5, approved an Online-supplied per-boost corporate LABEL, and confirmed that
agencies see only their own names and return IDs only.

## 1. Flip7 → Tailwind v4 tokens

`apps/admin/styles/tokens.css` remains the value source. P1.1 adds `tailwindcss` v4,
`@tailwindcss/postcss` and `motion`; no Tailwind JavaScript configuration or new component
library. Use top-level `@theme inline` aliases so utility classes resolve existing CSS
variables. The Flip7 mapping below is implemented; the previous InsightDeck values
are replaced only where the mapping calls for it. Existing token names remain
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
brand-ink/accent, shadow and scrim names working for existing screens. They are retained
compatibility values, not a license to use unmeasured pairs on new registry screens.
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

## 3. Registry motion and interaction spec

P1.1 supplies `DropdownPop` and `RowToCard`, with an app-level client boundary
for `<MotionConfig reducedMotion="user">`. Content renders immediately. Never animate
table-cell width/height, page camera zoom or blur. Layout projection may transform the
floating card; text/content can crossfade without distorting a live HTML table row.
[MotionConfig behavior](https://motion.dev/docs/react-motion-config) informs the wrapper;
the timings below define the Hub interaction choices.

| Screen / interaction | Motion | Focus, URL and reduced-motion behavior |
|---|---|---|
| Registry list → detail | Matching `layoutId` for the row's visual summary and floating card; spring stiffness ~400, damping ~35, perceived ≤300ms | A real link/button inside the semantic row opens it. Move focus to the card heading/first control; contain tab focus. Back/close/Esc restores the exact opener; if filtered away, focus list heading. |
| List/inbox backdrop | Opacity 0→1, 180ms; no animated blur | Outside click closes read-only detail; background is inert while open. With an unsaved binding form, retain draft and ask before discard. Reduced motion: 0–100ms fade. |
| Detail card tabs | Card `layout`, content opacity and shared-layout tab underline, 220ms | Thai tabs `รายละเอียด`, `ชื่อและลิงก์ติดตาม`, `รหัสบนแพลตฟอร์ม`; tablist keyboard behavior. Reduced motion: instant layout/underline and no transform. |
| Wizard cascading picker | `DropdownPop`: scale .96→1 and opacity, 140ms; origin at trigger | Search/checkbox list with visible labels, arrows/Enter/Esc as appropriate. Closing restores trigger focus. For ≥2 selection use checkboxes, never a hover-only menu. Reduced motion: scale off, instant or ≤100ms fade. |
| Wizard step change and preview | Static step panels, optional ≤150ms opacity | Next focuses step heading; validation failure focuses error summary. Announce latest preview politely without moving focus; no row morph or decorative slide. Reduced motion: instant. |
| ID-return inbox → binding card | Reuse `RowToCard`, same backdrop and tabs | First editable field receives focus; save announces outcome. Deep link contains code/tab only, no sensitive form inputs. Reduced motion same as list. |

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

## 6. Assistant — TODO (owner P5)

Headed placeholder only. Design tools, panel, citations, streaming and Thai evaluation
in P5; no assistant API, prompt or component is authorized in P1.

## 7. Media lines and memo register — TODO (owner P2)

Headed placeholder only; no screens or financial controls designed here.

## 8. Line actuals and exception screens — TODO (owner P3)

Headed placeholder only; pending DW read-back contract.

## 9. E-memo archive and search — TODO (owner P4)

Headed placeholder only; pending access and hosting decisions.

## 10. Other ads screens / wider UI refresh — TODO (outside P1)

P2–P5 own their respective screens above. Remaining financial flows and broader UI
refresh belong to separately scheduled P6; no design or implementation starts here.
