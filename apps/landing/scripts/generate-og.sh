#!/usr/bin/env bash
#
# Regenerates the landing page's social card and its icons.
#
# Same arrangement as `scripts/generate-brand.sh` at the repository root, and
# for the same reason: the mark is geometry in a script rather than a
# checked-in SVG, so there is one definition and editing it means editing four
# rectangles. The four below are copied from that script and from
# `components/site/mark.tsx`; if they ever disagree, that script is the
# original.
#
# Requires: rsvg-convert (librsvg), magick (ImageMagick 7), curl.
#
#   ./scripts/generate-og.sh
#
set -euo pipefail

cd "$(dirname "$0")/.."

LIME='#D2F34B'
TEXT='#F5F5F7'
MUTED='#A1A1AC'
DIM='#84848F'

# Mark geometry in a 100x100 space. Bounding box is x 16..80, y 8..97.
STEM='<rect x="16" y="8" width="22" height="68" rx="7.5"/>'
BAR='<rect x="16" y="54" width="62" height="22" rx="7.5"/>'
PLATE='<rect x="56" y="33" width="24" height="64" rx="8.5"/>'
HALO='<rect x="52.5" y="29.5" width="31" height="71" rx="12"/>'

MARK_X=16
MARK_Y=8
MARK_H=89

W=1200
H=630

# place_at <x> <y> <height> — transform putting the mark's top-left corner at
# (x,y), scaled to the given height.
place_at() {
  awk -v x="$1" -v y="$2" -v th="$3" -v h="$MARK_H" -v mx="$MARK_X" -v my="$MARK_Y" 'BEGIN{
    s = th / h
    printf "translate(%.4f,%.4f) scale(%.6f)", x - mx*s, y - my*s, s
  }'
}

# The mask rectangle must match the canvas rather than merely exceed it —
# librsvg allocates the mask surface in device pixels, and an oversized rect
# silently yields an empty mask at large output scales.
mark_svg() {
  cat <<EOF
<defs><mask id="seam" maskUnits="userSpaceOnUse" x="0" y="0" width="$W" height="$H">
  <rect x="0" y="0" width="$W" height="$H" fill="#fff"/>
  <g transform="$1" fill="#000">$HALO</g>
</mask></defs>
<g fill="$LIME">
  <g mask="url(#seam)"><g transform="$1">$STEM$BAR</g></g>
  <g transform="$1">$PLATE</g>
</g>
EOF
}

# Archivo is what the page is set in, and it is not installed system-wide.
# Fetch the two cuts the card uses into a scratch fontconfig root for the
# duration of the render, exactly as the root brand script does with Inter —
# otherwise rsvg falls back to whatever sans-serif it finds and the card stops
# matching the site.
FONTS=$(mktemp -d)
trap 'rm -rf "$FONTS"' EXIT

fetch_cut() {
  local weight=$1 out=$2 url
  url=$(curl -sfL -A 'Mozilla/5.0' \
    "https://fonts.googleapis.com/css2?family=Archivo:wght@${weight}" |
    grep -o 'https://[^)]*\.ttf' | head -1)
  [ -n "$url" ] || return 1
  curl -sfL "$url" -o "$FONTS/$out"
}

if ! fetch_cut 800 archivo-800.ttf || ! fetch_cut 500 archivo-500.ttf; then
  echo "error: could not fetch Archivo from Google Fonts" >&2
  exit 1
fi

cat > "$FONTS/fonts.conf" <<EOF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>$FONTS</dir>
  <cachedir>$FONTS/cache</cachedir>
</fontconfig>
EOF

MARK_T=$(place_at 96 96 132)
card=$(mktemp --suffix=.svg)
cat > "$card" <<EOF
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 $W $H" width="$W" height="$H">
  <defs><linearGradient id="plate" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0" stop-color="#101014"/><stop offset="1" stop-color="#000000"/>
  </linearGradient></defs>
  <rect width="$W" height="$H" fill="url(#plate)"/>
  $(mark_svg "$MARK_T")
  <text x="96" y="352" font-family="Archivo" font-weight="800" font-size="112"
        fill="$TEXT" letter-spacing="-4">Log the set.</text>
  <text x="96" y="452" font-family="Archivo" font-weight="800" font-size="112"
        fill="$TEXT" letter-spacing="-4">Get back to the bar<tspan fill="$LIME">.</tspan></text>
  <rect x="96" y="512" width="120" height="3" fill="$LIME"/>
  <text x="96" y="566" font-family="Archivo" font-weight="500" font-size="30"
        fill="$MUTED" letter-spacing="-0.3">Lift</text>
  <text x="164" y="566" font-family="Archivo" font-weight="500" font-size="30"
        fill="$DIM" letter-spacing="-0.3">Local-first workout tracker. Offline, no account, AGPL-3.0.</text>
</svg>
EOF

FONTCONFIG_FILE="$FONTS/fonts.conf" rsvg-convert -w "$W" -h "$H" "$card" -o app/opengraph-image.png
rm -f "$card"

# Favicon and touch icon, taken from the app's own generated assets so the tab
# and the home screen carry the same mark the phone does.
magick ../mobile/assets/images/favicon.png -resize 64x64 app/icon.png
magick ../mobile/assets/images/icon.png -resize 180x180 app/apple-icon.png

echo "Wrote:"
for f in app/opengraph-image.png app/icon.png app/apple-icon.png; do
  printf '  %-30s %s\n' "$f" "$(magick identify -format '%wx%h' "$f")"
done
