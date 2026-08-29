import type { StaticImageData } from "next/image";

import bodyShot from "../../../screenshots/measurements.png";
import calendarShot from "../../../screenshots/calendar.png";
import historyShot from "../../../screenshots/history.png";
import homeShot from "../../../screenshots/home.png";
import profileShot from "../../../screenshots/profile.png";
import sessionShot from "../../../screenshots/session.png";
import statsShot from "../../../screenshots/stats.png";
import workoutShot from "../../../screenshots/routines.png";

/**
 * The screenshots this page frames, taken straight out of `screenshots/` at the
 * repository root.
 *
 * There used to be a second set under `public/screens`, shot at a taller
 * geometry for this page alone. Two sets of the same screens is two things to
 * keep true, and the second one drifted the moment the app moved. This file now
 * imports the same PNGs the root README shows, so a run of
 * `scripts/screenshots/capture.mjs` updates both at once and neither can be
 * newer than the other.
 *
 * They are imported rather than served out of `public` on purpose: a static
 * import is compiled, so Next reads the real dimensions off the file rather
 * than being told them by hand. It also means `Dockerfile` has to copy
 * `screenshots/` into the build stage, which it does, and which is the one
 * cost of keeping a single set.
 *
 * There is now a second aspect ratio to keep an eye on. `components/site/phone.tsx`
 * lays these into the glass of a device mockup and takes its own proportions
 * from that artwork, so a capture geometry that drifted far from the mockup's
 * 0.4610 would start being cropped by `object-cover` rather than merely
 * letterboxed. The current 780x1688 is 0.4621, which crops half a pixel.
 *
 * Nothing here is a mockup, and nor is it anybody's real log: the capture
 * script drives the app in a browser against a year generated from a fixed
 * seed, and every figure on these screens is the app's own arithmetic over it.
 * **An alt text that quotes a number means re-reading that number off the new
 * screen** when the set is retaken.
 */
export interface Screen {
  src: StaticImageData;
  alt: string;
  /** Short caption, used where the screen appears without prose beside it. */
  caption: string;
}

export const screens = {
  home: {
    src: homeShot,
    alt: "The home tab: 44,282 kg this week, up 3 percent, over a twelve week volume chart, with last session's set count, bodyweight and a grid of training days under it",
    caption: "Home",
  },
  workout: {
    src: workoutShot,
    alt: "The workout tab: a start empty workout button above four saved routines, each with the date it was last performed",
    caption: "Routines",
  },
  activeWorkout: {
    src: sessionShot,
    alt: "A workout in progress: 37 minutes elapsed, 7 of 16 sets done, each row carrying last session's numbers, an RPE chip and a tick",
    caption: "Active workout",
  },
  statistics: {
    src: statsShot,
    alt: "Statistics: four of the last seven days trained at 72 sets, and front and back body figures shaded by weekly sets against each muscle's target range",
    caption: "Statistics",
  },
  calendar: {
    src: calendarShot,
    alt: "August 2026 shaded day by day against a typical session: 17 sessions, 164,432 kg, 20 hours 13 minutes, and the month's workouts listed below with their personal records",
    caption: "Calendar",
  },
  history: {
    src: historyShot,
    alt: "Three months of history: 50 workouts, 60 hours 52 minutes, 493,195 kg and 863 sets, above the sessions themselves",
    caption: "History",
  },
  body: {
    src: bodyShot,
    alt: "Body measurements: bodyweight at 83.7 kg with its trend and weekly rate, and the body fat, lean mass, waist-to-height and BMI derived from it",
    caption: "Body",
  },
  profile: {
    src: profileShot,
    alt: "The profile tab: 1,683,925 kg lifted over 182 sessions, above an account that is optional and signed out",
    caption: "Profile",
  },
} as const satisfies Record<string, Screen>;
