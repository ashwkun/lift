import type { StaticImageData } from "next/image";

import catppuccinShot from "../../../screenshots/theme-catppuccin.png";
import darkShot from "../../../screenshots/theme-dark.png";
import fitnessShot from "../../../screenshots/theme-fitness.png";
import gruvboxShot from "../../../screenshots/theme-gruvbox.png";
import lightShot from "../../../screenshots/theme-light.png";
import nordShot from "../../../screenshots/theme-nord.png";
import solarizedShot from "../../../screenshots/theme-solarized.png";
import spotifyShot from "../../../screenshots/theme-spotify.png";

/**
 * The eight palettes, and one screenshot of each.
 *
 * All eight are the same screen in the same state, which is the only reason
 * the appearance section can switch between them: `scripts/screenshots/capture.mjs`
 * generates them from one route, and the comment there says so in as many
 * words. Shot separately they would be a slideshow rather than a comparison.
 *
 * The app offers nine choices, not eight. `system` is the ninth and it has no
 * palette of its own, it follows the phone, so there is nothing to photograph:
 * it resolves to Light or Dark, both of which are here.
 *
 * The three colours per row are copied from the app rather than sampled from
 * the screenshots. `background` and `surface` come from each palette in
 * `apps/mobile/src/theme/palettes.ts` (Light and Dark are in `tokens.ts`), and
 * `accent` is the one saturated colour that palette spends. They only have to
 * be close enough for a 40px swatch, but they are exact, because a swatch that
 * is nearly the theme is worse than one that is obviously a symbol.
 */
export interface Palette {
  id: string;
  label: string;
  shot: StaticImageData;
  /** What the palette is for, in the four or five words a caption allows. */
  note: string;
  background: string;
  surface: string;
  accent: string;
  /*
   * The switching is CSS, and this is the wiring: it puts the matching screen
   * at full opacity when this palette's radio is the checked one.
   *
   * `group-has-[…]` rather than a sibling selector, because the radio now sits
   * beside the label a reader clicks and the screen it controls is three
   * levels away in the other column. A sibling combinator cannot cross that;
   * `:has()` on a common ancestor can, and the ancestor is the one element
   * carrying `group`.
   *
   * Written out rather than built from `id`. Tailwind generates from literal
   * strings it can find in the source, so a template would produce no rule at
   * all: a picker that silently does nothing rather than a build error.
   */
  reveal: string;
}

export const palettes: Palette[] = [
  {
    id: "dark",
    label: "Dark",
    shot: darkShot,
    note: "True black, one lime accent",
    background: "#000000",
    surface: "#1A1A1A",
    accent: "#D2F34B",
    reveal: "group-has-[#palette-dark:checked]:opacity-100",
  },
  {
    id: "light",
    label: "Light",
    shot: lightShot,
    note: "For gyms with windows",
    background: "#F4F4F6",
    surface: "#FFFFFF",
    accent: "#54700A",
    reveal: "group-has-[#palette-light:checked]:opacity-100",
  },
  {
    id: "nord",
    label: "Nord",
    shot: nordShot,
    note: "Polar night, two steps down",
    background: "#161A22",
    surface: "#1D222C",
    accent: "#B8DAE3",
    reveal: "group-has-[#palette-nord:checked]:opacity-100",
  },
  {
    id: "gruvbox",
    label: "Gruvbox",
    shot: gruvboxShot,
    note: "Warm greys, retro contrast",
    background: "#141617",
    surface: "#1D2021",
    accent: "#D5D942",
    reveal: "group-has-[#palette-gruvbox:checked]:opacity-100",
  },
  {
    id: "catppuccin",
    label: "Catppuccin",
    shot: catppuccinShot,
    note: "Mocha, with a lilac accent",
    background: "#0C0C14",
    surface: "#15151F",
    accent: "#E0CAFA",
    reveal: "group-has-[#palette-catppuccin:checked]:opacity-100",
  },
  {
    id: "spotify",
    label: "Spotify",
    shot: spotifyShot,
    note: "The green you already know",
    background: "#121212",
    surface: "#1A1A1A",
    accent: "#1ED760",
    reveal: "group-has-[#palette-spotify:checked]:opacity-100",
  },
  {
    id: "fitness",
    label: "Fitness",
    shot: fitnessShot,
    note: "Rings red on true black",
    background: "#000000",
    surface: "#141416",
    accent: "#FF375F",
    reveal: "group-has-[#palette-fitness:checked]:opacity-100",
  },
  {
    id: "solarized",
    label: "Solarized",
    shot: solarizedShot,
    note: "Cream paper, ink blue",
    background: "#EEE8D5",
    surface: "#FDF6E3",
    accent: "#185783",
    reveal: "group-has-[#palette-solarized:checked]:opacity-100",
  },
];

/** The one shown before anybody touches the picker, and the app's own default. */
export const DEFAULT_PALETTE = "dark";
