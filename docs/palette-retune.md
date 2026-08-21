# Palette retune

A record of what changed in `apps/mobile/src/theme/tokens.ts` and why. The
reasoning behind each individual value lives next to that value in the tokens
file, where it cannot drift; this is the before-and-after view that a file of
constants cannot give you.

Run `node scripts/audit-palette.mjs` to re-measure everything below.

## The root cause

Five role colours ran at 62–100% saturation and 51–68% lightness. Nothing was
subordinate to anything, so the lime was not read as *the* accent — it was one
of the loud ones. Three defects came out of that, one of them an accessibility
failure.

## What was wrong

### White text on red failed AA

`textOnDanger` was `#FFFFFF` on `danger: #FF5A5A` — **3.06:1**, against a 4.5
requirement. That was the label on every filled Discard and Delete button, in a
palette whose stated premise is that each role names its own foreground so a
filled control cannot pick an unreadable one.

It could not be fixed by darkening the red: white only reaches 4.5 at around
`#B3282E`, which is a muddy brick on a true-black canvas. So destructive buttons
stopped filling — see the `danger` variant in `components/ui/button.tsx`.

| | Was | Now |
|---|---|---|
| Label contrast | 3.06:1 | 5.38:1 on the canvas, 4.87 on a card |

### `warning` and `record` were the same colour on dark

Hue 43° against 42° — one degree apart. A PR badge and a validation warning were
the same colour on the same card, with nothing but their glyph to tell them
apart. The light palette had already separated these by hue and documented why
(a PR marker is often a 13px trophy, where a lightness step does not register);
the dark palette, which is the primary one, never got the change.

| | Was | Now |
|---|---|---|
| Hue separation | 1° | 13° |

### Two greens on every completed set

A checked-off row tints `accentSurface` — lime, 72° — and its check plate filled
`success`, which was `#34D07A` at 147°. Two greens 75° apart, touching, on the
one interaction the app exists to perform. That gap is the worst of both worlds:
too close to read as deliberate contrast, too far to read as one family.

| | Was | Now |
|---|---|---|
| Hue separation | 75° | 43° |

## The values

### Dark

| Role | Was | Now | Note |
|---|---|---|---|
| `accent` | `#D2F34B` 72° | `#D2F34B` 72° | unchanged — the identity |
| `success` | `#34D07A` 147° | `#63CC5A` 115° | yellow-green, same family as the lime |
| `warning` | `#FBBF24` 43° | `#E8913C` 30° | burnt orange, clear of `record` |
| `danger` | `#FF5A5A` 0° | `#EC5A62` 357° | off pure red, and its foreground went dark |
| `record` | `#FFC53D` 42° | `#F5C445` 43° | gold held, saturation stepped down |

Luminance now ranks `accent` 0.783 · `record` 0.593 · `success` 0.466 ·
`warning` 0.377 · `danger` 0.260. **The accent outranking every other role is
the invariant worth re-checking whenever one of these moves** — it is what makes
the lime read as the accent rather than as one of five loud colours.

### Light

| Role | Was | Now | Note |
|---|---|---|---|
| `success` | `#0F7A36` 142° | `#2A6B1E` 111° | tracks the dark palette's hue |
| `danger` | `#DC2626` 0° | `#B3242C` 357° | 4.30 on its own tint → 5.08 |
| `warning` | `#A34A07` 26° | unchanged | tint alpha 0.14 → 0.10 |
| `record` | `#6E5C00` 50° | unchanged | tint alpha 0.14 → 0.10 |

Hues are held within 5° of the dark palette so the two themes name the same
colours.

## The trap worth knowing

**Strengthening a tint that its own label is printed on lowers contrast.** The
`*Surface` tokens are the role colour at low alpha, and badges, chips and the
destructive button print the role colour on top of them — so as the tint
deepens, the two move together. On the dark palette, `danger` goes under AA on a
card at roughly 1.5× its base alpha.

That is why the light tints came down to 0.10, and why the destructive button
presses through its **outline** rather than its fill: the outline is not text,
has no ratio to meet, and can travel the whole way to solid.

## Verification

`scripts/audit-palette.mjs` parses both palettes out of the tokens file and runs
82 checks:

- every role as text on all three surfaces
- every named foreground on its role fill, resting **and pressed**
- every role as text on its own tint, over both the canvas and a card
- a pressed fill is darker than its resting one
- hue separation between roles that must not be confused
- the accent outranks every role in luminance (dark only — see the note in the
  script for why this one is not run against light)
- the two palettes name the same hues
- the success plate on the lime-tinted set row

It exits non-zero on the first failure, so it can go in CI.
