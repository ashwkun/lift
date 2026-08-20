#!/usr/bin/env bash
#
# Regenerates every brand asset — app icons and the README banner — from the
# vector mark defined below.
#
# The mark lives here rather than in a checked-in SVG because each output needs
# a different scale: an adaptive-icon foreground has to sit inside Android's
# safe zone, the splash asset wants to fill its frame, and the banner places
# the mark against a wordmark. One source and a placement helper is what stops
# the outputs from drifting apart.
#
# Requires: rsvg-convert (librsvg), magick (ImageMagick 7).
#
#   ./scripts/generate-brand.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."
ICONS=apps/mobile/assets/images
DOCS=docs
mkdir -p "$ICONS" "$DOCS"

LIME='#D2F34B'
INK='#0C0C0F'
TEXT='#F5F5F7'
MUTED='#A1A1AC'

# Mark geometry, in a 100x100 space. Bounding box is x 16..80, y 8..97.
#
# `plate` is centred on the bar's midline (y=65) so the bar reads as passing
# through it. `halo` is the same rectangle grown by 3.5 units and is punched
# out of the stem+bar layer — that transparent seam is the only thing
# separating plate from bar, since both are the same flat lime. Without it the
# two shapes merge into an unreadable blob.
STEM='<rect x="16" y="8" width="22" height="68" rx="7.5"/>'
BAR='<rect x="16" y="54" width="62" height="22" rx="7.5"/>'
PLATE='<rect x="56" y="33" width="24" height="64" rx="8.5"/>'
HALO='<rect x="52.5" y="29.5" width="31" height="71" rx="12"/>'

MARK_X=16
MARK_Y=8
MARK_W=64
MARK_H=89

# centre_in <canvas> <height-fraction> — transform centring the mark in a
# square canvas at that fraction of its height.
centre_in() {
  awk -v c="$1" -v f="$2" -v h="$MARK_H" -v mx="$MARK_X" -v my="$MARK_Y" -v mw="$MARK_W" 'BEGIN{
    s = f * c / h
    printf "translate(%.4f,%.4f) scale(%.6f)", c/2 - (mx + mw/2)*s, c/2 - (my + h/2)*s, s
  }'
}

# place_at <x> <y> <height> — transform putting the mark's top-left corner at
# (x,y), scaled to the given height.
place_at() {
  awk -v x="$1" -v y="$2" -v th="$3" -v h="$MARK_H" -v mx="$MARK_X" -v my="$MARK_Y" 'BEGIN{
    s = th / h
    printf "translate(%.4f,%.4f) scale(%.6f)", x - mx*s, y - my*s, s
  }'
}

# mark_svg <transform> <fill> <canvas-w> <canvas-h> — the mark itself, mask
# included.
#
# The mask rectangle must match the canvas, not merely exceed it. librsvg
# allocates a mask surface in device pixels, so an arbitrarily huge rect
# overflows once the output scale climbs — at 1024px on a 100-unit viewBox it
# silently yields an empty mask and the stem and bar vanish, leaving only the
# plate.
mark_svg() {
  cat <<EOF
<defs><mask id="seam" maskUnits="userSpaceOnUse" x="0" y="0" width="$3" height="$4">
  <rect x="0" y="0" width="$3" height="$4" fill="#fff"/>
  <g transform="$1" fill="#000">$HALO</g>
</mask></defs>
<g fill="$2">
  <g mask="url(#seam)"><g transform="$1">$STEM$BAR</g></g>
  <g transform="$1">$PLATE</g>
</g>
EOF
}

# render_icon <outfile> <px> <height-fraction> <fill> <background-svg>
render_icon() {
  local out=$1 px=$2 frac=$3 fill=$4 bg=$5 t tmp
  t=$(centre_in 100 "$frac")
  tmp=$(mktemp --suffix=.svg)
  cat > "$tmp" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="$px" height="$px">
  <defs><linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#14141A"/><stop offset="1" stop-color="#08080A"/>
  </linearGradient></defs>
  $bg
  $(mark_svg "$t" "$fill" 100 100)
</svg>
EOF
  rsvg-convert -w "$px" -h "$px" "$tmp" -o "$out"
  rm -f "$tmp"
}

FULL_BG='<rect width="100" height="100" fill="url(#plate)"/>'

# --- app icons ------------------------------------------------------------

# Store/home-screen icon. The whole canvas is visible here — iOS only rounds
# the corners — so this fraction is the mark's true share of the icon.
render_icon "$ICONS/icon.png" 1024 0.62 "$LIME" "$FULL_BG"

# Adaptive icon foreground.
#
# Android does not scale this layer down to fit the mask: it displays the
# central 66% of the 108dp canvas at full icon size and discards the rest. So
# a mark drawn at 62% here would render at 62/0.66 ≈ 94% of the visible icon —
# roughly half again the size of the iOS one. Pre-dividing by the crop keeps
# both platforms at the same apparent size.
render_icon "$ICONS/android-icon-foreground.png" 512 0.42 "$LIME" ''

# Themed ("monochrome") icon — also an adaptive layer, so it takes the same
# crop and the same fraction. Android reads only the alpha channel and applies
# its own wallpaper-derived tint, so the fill colour is arbitrary; white is
# the convention.
render_icon "$ICONS/android-icon-monochrome.png" 432 0.42 '#FFFFFF' ''

# Splash. app.json pins this to imageWidth 76, so the mark fills most of the
# frame rather than shipping padding that would shrink it further.
render_icon "$ICONS/splash-icon.png" 512 0.86 "$LIME" ''

render_icon "$ICONS/favicon.png" 256 0.62 "$LIME" "$FULL_BG"

# Adaptive icon background layer: a flat plate matching the icon's backdrop.
magick -size 512x512 "xc:$INK" "$ICONS/android-icon-background.png"

# --- README banner --------------------------------------------------------

# The wordmark is set in Inter, the same face the app loads. Inter is not
# installed system-wide, so point fontconfig at the copy in node_modules for
# the duration of this render — otherwise rsvg silently falls back to whatever
# sans-serif it finds and the banner stops matching the app.
INTER_DIR=$(find node_modules/@expo-google-fonts/inter apps/mobile/node_modules/@expo-google-fonts/inter \
  -name 'Inter_700Bold.ttf' 2>/dev/null | head -1 | xargs -r dirname | xargs -r dirname || true)

if [ -z "$INTER_DIR" ]; then
  echo "warning: Inter not found in node_modules — run pnpm install; skipping banner" >&2
else
  FC=$(mktemp -d)
  cat > "$FC/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>$(cd "$INTER_DIR" && pwd)</dir>
  <cachedir>$FC/cache</cachedir>
</fontconfig>
EOF

  # The lockup is drawn on an oversized transparent canvas and then trimmed to
  # its own ink, rather than sized by hand. Text advance width depends on the
  # font's metrics, so any hardcoded canvas either clips the tagline or leaves
  # a slab of dead space to its right — trimming makes the padding exact
  # whatever the wordmark says.
  BANNER_T=$(place_at 100 158 165)
  tmp=$(mktemp --suffix=.svg)
  cat > "$tmp" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1800 560" width="1800" height="560">
  $(mark_svg "$BANNER_T" "$LIME" 1800 560)
  <text x="280" y="250" font-family="Inter" font-weight="700" font-size="124"
        fill="$TEXT" letter-spacing="-4">Lift</text>
  <text x="284" y="312" font-family="Inter" font-weight="500" font-size="40"
        fill="$MUTED" letter-spacing="-0.5">Local-first workout tracker</text>
</svg>
EOF
  lockup=$(mktemp --suffix=.png)
  FONTCONFIG_FILE="$FC/fonts.conf" rsvg-convert -w 1800 -h 560 "$tmp" -o "$lockup"
  magick "$lockup" -trim +repage -bordercolor none -border 104x84 "$lockup"

  # The trailing newline matters: without it `read` hits EOF, returns
  # non-zero, and `set -e` aborts the script even though BW/BH were assigned.
  read -r BW BH < <(magick identify -format '%w %h\n' "$lockup")
  magick -size "${BW}x${BH}" gradient:'#14141A'-'#08080A' \
    \( -size "${BW}x${BH}" xc:none -draw "roundrectangle 0,0,$((BW-1)),$((BH-1)),40,40" \) \
    -alpha set -compose CopyOpacity -composite \
    "$lockup" -compose Over -composite "$DOCS/banner.png"
  rm -rf "$tmp" "$lockup" "$FC"
fi

echo "Wrote:"
for f in "$ICONS"/icon.png "$ICONS"/android-icon-foreground.png "$ICONS"/android-icon-monochrome.png \
         "$ICONS"/android-icon-background.png "$ICONS"/splash-icon.png "$ICONS"/favicon.png "$DOCS"/banner.png; do
  [ -f "$f" ] && printf '  %-46s %s\n' "$f" "$(magick identify -format '%wx%h' "$f")"
done
