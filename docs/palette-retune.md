# Palette retune

A record of what changed in `apps/mobile/src/theme/tokens.ts` and
`palettes.ts`, and why. The reasoning behind each individual value lives next to
that value in the theme files, where it cannot drift; this is the
before-and-after view that a file of constants cannot give you.

Run `node scripts/audit-palette.mjs` to re-measure everything below.

## The root cause

Five role colours ran at 62–100% saturation and 51–68% lightness. Nothing was
subordinate to anything, so the lime was not read as *the* accent. It was one
of the loud ones. Three defects came out of that, one of them an accessibility
failure.

## What was wrong

### White text on red failed AA

`textOnDanger` was `#FFFFFF` on `danger: #FF5A5A`: **3.06:1**, against a 4.5
requirement. That was the label on every filled Discard and Delete button, in a
palette whose stated premise is that each role names its own foreground so a
filled control cannot pick an unreadable one.

It could not be fixed by darkening the red: white only reaches 4.5 at around
`#B3282E`, which is a muddy brick on a true-black canvas. So destructive buttons
stopped filling: see the `danger` variant in `components/ui/button.tsx`.

| | Was | Now |
|---|---|---|
| Label contrast | 3.06:1 | 5.38:1 on the canvas, 4.87 on a card |

### `warning` and `record` were the same colour on dark

Hue 43° against 42°: one degree apart. A PR badge and a validation warning were
the same colour on the same card, with nothing but their glyph to tell them
apart. The light palette had already separated these by hue and documented why
(a PR marker is often a 13px trophy, where a lightness step does not register);
the dark palette, which is the primary one, never got the change.

| | Was | Now |
|---|---|---|
| Hue separation | 1° | 13° |

### Two greens on every completed set

A checked-off row tints `accentSurface` (lime, 72°) and its check plate filled
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
| `accent` | `#D2F34B` 72° | `#D2F34B` 72° | unchanged: the identity |
| `success` | `#34D07A` 147° | `#63CC5A` 115° | yellow-green, same family as the lime |
| `warning` | `#FBBF24` 43° | `#E8913C` 30° | burnt orange, clear of `record` |
| `danger` | `#FF5A5A` 0° | `#EC5A62` 357° | off pure red, and its foreground went dark |
| `record` | `#FFC53D` 42° | `#F5C445` 43° | gold held, saturation stepped down |

Luminance now ranks `accent` 0.783 · `record` 0.593 · `success` 0.466 ·
`warning` 0.377 · `danger` 0.260. **The accent outranking every other role is
the invariant worth re-checking whenever one of these moves**. It is what makes
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
destructive button print the role colour on top of them, so as the tint
deepens, the two move together. On the dark palette, `danger` goes under AA on a
card at roughly 1.5× its base alpha.

That is why the light tints came down to 0.10, and why the destructive button
presses through its **outline** rather than its fill: the outline is not text,
has no ratio to meet, and can travel the whole way to solid.

## The second pass: six palettes nobody had measured

Everything above is about `tokens.ts`. `palettes.ts` holds six more, ported from
Nord, Gruvbox, Catppuccin Mocha, Spotify, Apple's Fitness app and Solarized
Light, and the auditor never read that file: it named `darkPalette` and
`lightPalette` and stopped. Six palettes shipped on a hand check that ran once.
Pointing the script at them found three values under the line.

| Theme | Token | Was | Now | On `surfaceMuted` |
|---|---|---|---|---|
| Spotify | `danger` | `#EB6975` | `#F08B94` | 3.58 → 4.64 |
| Spotify | `warning` | `#FF812B` | `#FF8735` | 4.43 → 4.61 |
| Solarized | `record` | `#765A00` | `#745800` | 4.4962 → 4.63 |

Three failures, one pairing. All of them are a role printed as text on the muted
fill, which is what inputs, chips and table stripes use. It is the lightest
ground a dark palette puts a role on and the darkest a light one does, so it is
where a palette fails first, and it is the pairing least likely to be noticed by
eye: nobody opens a theme picker to look at an input background.

Solarized's is the one worth staring at. `record` measured **4.4962**, which
prints as 4.50 and is not 4.50. The bar either means something or it does not.

### The surface that could not move instead

The obvious repair for Spotify is to take `surfaceMuted` from `#3C3C3C` to the
`#282828` Spotify itself uses for a card. That hands every role on it most of a
stop and needs no colour to change. It cannot go. `surfaceMuted` is where the
calendar's ramp starts, and the second of that ramp's four stops is the tightest
pairing in the palette: 5.06:1 against a 5:1 bar at `#3C3C3C`, and 4.93 at
`#383838`. Repairing two roles by breaking a ramp stop is not a repair.

So the roles moved and Spotify's red paid for it. `#F08B94` is a light rose
rather than a red, and further from Spotify's own `#E22134` than any other port
pushes its red. That colour was never available here at any depth: it reads 2.36
on the same fill, and Spotify does not print it on grey either.

Solarized went the other way and deepened, which is what that palette does with
every foreground it quotes. Its five roles now sit between 4.50 and 4.64 on the
muted fill, all of them within 0.15 of the bar, which is the honest shape of a
theme whose published accents measure below AA on its own paper.

## The family that was missing: the neutral text ramp

The auditor checked five role colours on three surfaces and never checked the
three colours the app prints most. `text`, `textSecondary` and `textTertiary`
are now a family of their own, on the same three grounds.

Seven of the eight palettes pass it outright. The light palette's `textTertiary`
does not, at 4.09 on the canvas and 3.91 on a muted fill, and `tokens.ts` has
said so beside the value for as long as the value has existed: a third tier dark
enough to clear 4.5 on `background` lands within a step of `textSecondary` and
collapses a three-tier ramp into two.

So that tier is allowed to fail by name, in a `WAIVED` map in the script, rather
than being dropped from the family. The three pairs are listed one at a time,
the check still runs and still prints its real ratio, and every other palette is
held to the full 4.5. What is waived is not really the contrast, it is a usage
rule: `textTertiary` on light may only repeat something a higher tier has
already said, and never carry the only copy of a fact.

**Four call sites break that rule and are not fixed here**, being outside the
files this change touches:

| File | Copy that appears nowhere else |
|---|---|
| `app/_layout.tsx` | "Your workouts are still on this device. Export a copy before reinstalling." |
| `app/import.tsx` | the backup hint under the export card |
| `app/import.tsx` | "Nothing in the file falls in that window." |
| `app/settings/index.tsx` | the version string in the settings footer |

The crash screen's is the worst of them: the one line telling a user their data
survives, printed in the tier reserved for text that does not matter, at 4.09.
All four want `textSecondary`.

Fitness is waived for a different check. Its `accent` is Apple's Move ring and
does not outrank the other roles in luminance, which `palettes.ts` works through
at length: lifting a crimson until it wins turns it into a salmon, so the
palette closes the gap from the other side instead. That was always a decision.
It is now a decision the script has been told about, printed beside the 0.248
the Move ring sits at while `record` sits at 0.461.

## The category ramp, and Fitness un-flattened

A later change, in two halves: every palette grew a set of colours that are not
about status at all, and the Fitness theme stopped hiding its own.

### `data`: six hues that are not statuses

Every token in the palette answered "what kind of thing is this". None of them
could say "this series is duration and that one is reps", so charts drew every
series in the accent and leaned on a legend, and every list of categories drew
six identical grey glyphs. `Palette` now carries a six-long `data` ramp for
exactly that.

- `data[0]` **is** the palette's `accent`, repeated rather than approximated, so
  a single-series chart is unchanged and a chart that grows a second series
  keeps its first one where it was. Checked by string equality in the audit.
- Every entry clears **AA on all three surfaces**, not the graphical-object bar,
  because the point is that a figure can be printed in its series' colour.
- Every pair is separated by **20° of hue or 1.15:1 of contrast**, and the audit
  prints which of the two carried each pair.

All eight themes define one, but not all eight are polychrome:

| Themes | Ramp | Why |
|---|---|---|
| `nord`, `gruvbox`, `catppuccin`, `spotify`, `solarized`, `fitness` | six hues, ≥20° apart | their sources are themselves multi-colour systems; Fitness's is Apple's system colours, five of six exact |
| `light`, `dark` | the accent and five steps of one hue | one saturated colour on a plain canvas is the whole of what those two themes are |

The monochrome pair is the worse ramp at the job the ramp exists for, and it is
worth being exact about the cost rather than glossing it: adjacent steps sit
1.19:1 apart, so six lime bars are told apart by order and label far more than
by colour. That number cannot be improved by picking better values. The scale is
bounded above by the accent (11.39 on `surfaceMuted`) and below by AA on the
same surface, which is a factor of 2.4 to divide among five gaps. Widening it
means a second hue or a step that fails AA.

Spotify keeps a polychrome ramp despite shipping one colour and a grey scale, so
five of its six are this app's rather than Spotify's, and its note says so. A
monochrome green was tried and does not fit: its `surfaceMuted` is `#3C3C3C`,
the lightest of any theme here, which leaves only 1.04:1 between steps.

### Fitness stopped flattening its roles

The `fitness` palette had every role squeezed into a 0.31–0.46 luminance band so
that nothing outshouted the Move ring at 0.248. The reasoning was sound about
this app's roles and wrong about the source: open Apple's Fitness app and the
Exercise ring is a full-brightness lime, the step count is bright violet, the
distance under it bright cyan, all on the same black canvas as the Move ring.
The multiplicity is the design. Flattened, the theme read as one colour on grey.

| Role | Was | Now | Note |
|---|---|---|---|
| `success` | `#73C115` 0.418 | `#A2E82C` 0.656 | the Exercise ring, published |
| `record` | `#D6B200` 0.461 | `#FFD426` 0.685 | systemYellow, published |
| `warning` | `#E78D00` 0.360 | `#FF9F0A` 0.461 | systemOrange, whole |
| `accent` | `#FF375F` 0.248 | unchanged | the Move ring, published |

The palette now spans 0.25 to 0.69. What pays for it is honesty rather than a
number: the accent is the *quietest* role here and there is no arrangement in
which it is not, so it leads on hue and on rationing instead. That is a weaker
guarantee than the other seven themes have and it is what the waiver records.

Its `data` ramp is the only one in the file that is a straight quotation:
systemPink, systemOrange, the Exercise ring, systemGreen, systemCyan and
systemPurple, five of six exact. systemPurple is lifted two points of lightness
because at its published value it measures 4.33 on its own tint.

### What `dark` is not

`dark` briefly took the Move crimson as its accent and it is worth recording why
that came out. The crimson is a dark colour (0.248 against the lime's 0.783) and
`dark`'s card ramp is two rungs lighter than Fitness's: measured on it the
accent read **4.08 on `surfaceMuted`** and **4.25 on its own tint**, two AA
failures. Lifting it to pass takes it to `#FF5274`, a rose. Dropping the ramp to
`#000` → `14` → `1B` → `22` → `2A` fixes it and makes `dark` a near-duplicate of
`fitness`, which is a strange thing for two themes to be.

`dark` keeps the lime. Fitness is where the crimson lives, and the ramp is how
both of them get more than one colour.

### Where it is actually spent

A ramp nothing draws in is a ramp that does not exist, which is what the first
pass of this change amounted to. It is now spent in four places:

| Surface | What gets a hue |
|---|---|
| Home masthead, History chart | the selected metric: volume is the accent, duration the blue, reps the violet (`METRIC.tone`) |
| Home tile grid | one hue per tile, on the icon (`tone` on `SquareWidget`/`WideWidget`) |
| Sets by body part, workout summary split | one hue per body part (`BODY_PART_TONE`) |
| Statistics hub, Settings, Profile | one hue per row, on the icon and its circle (`CATEGORY_TONES` on `ListRow`) |

Two rules hold all of it together and both are in `features/analytics/tones.ts`:

- **Body-part colour is a fixed map, not a position.** Every body-part chart in
  the app is sorted by volume, so a positional scheme would make chest crimson
  in a week you trained it hardest and orange in a week you did not. The colour
  would then encode rank, which the bar's length already encodes. Fixed, it
  encodes which muscle it is, and it says the same thing on Home, on the workout
  summary and on the stats screens.
- **`other` takes no hue.** It is the bucket for exercises that mapped to no
  muscle group, and colouring it puts the leftovers on equal footing with the
  six things the chart is about.

`Tone` in `components/ui/surfaces.tsx` grew the six alongside its five roles, so
anything that already took a tone can take a category. Index 0 resolves to the
palette's `accentSurface` rather than deriving a tint at 0.16: on Fitness 0.16
puts the Move ring under AA on its own tint, which is why `accentSurface` is
0.15 there, and the audit measures the pairing the component actually draws
rather than the one it was assumed to.

## Verification

`scripts/audit-palette.mjs` parses every palette out of `tokens.ts` and
`palettes.ts` and runs 755 checks across the eight themes in `THEMES`:

- every role as text on all three surfaces
- **the three neutral text tiers on all three surfaces**
- every named foreground on its role fill, resting **and pressed**
- every role as text on its own tint, over both the canvas and a card
- a pressed fill is darker than its resting one
- hue separation between roles that must not be confused
- **every `data` entry as text on all three surfaces**
- **every `data` entry on the tint `toneColors` derives for it**
- **every pair of `data` entries 20° apart in hue or 1.15:1 apart in contrast,
  and `data[0]` equal to `accent`**
- the accent outranks every role in luminance (dark schemes only: see the note
  in the script for why this one is not run against light)
- the two palettes this app designed for itself name the same hues
- the success plate on the accent-tinted set row, now in every theme

Which themes to audit is read out of `theme/index.tsx` rather than written down
in the script, because a list written down in the script is exactly how six
palettes went unmeasured.

It exits non-zero if anything fails, so it can go in CI.
