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
 * import is compiled, so Next reads the real dimensions off the file and the
 * frames below cannot be laid out against a size the image does not have. It
 * also means `Dockerfile` has to copy `screenshots/` into the build stage,
 * which it does, and which is the one cost of keeping a single set.
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
    alt: "The home tab: 5,354 kg logged this week, a twelve week volume chart, and sets by body part over thirty days",
    caption: "Home",
  },
  workout: {
    src: workoutShot,
    alt: "The workout tab, with an empty workout button above four saved routines",
    caption: "Routines",
  },
  activeWorkout: {
    src: sessionShot,
    alt: "A workout in progress: 37 minutes elapsed, 7 of 16 sets done, each row carrying last session's weight and reps beside it",
    caption: "Active workout",
  },
  statistics: {
    src: statsShot,
    alt: "Statistics: the last seven days at 52 sets, and front and back body figures shaded by weekly sets against each muscle's target range",
    caption: "Statistics",
  },
  calendar: {
    src: calendarShot,
    alt: "August 2026 shaded day by day against a typical session: 14 sessions, 125,623 kg, and the month's workouts listed below with their personal records",
    caption: "Calendar",
  },
  history: {
    src: historyShot,
    alt: "Three months of history: 47 workouts, 57 hours, 807 sets, charted by week above the muscles they trained",
    caption: "History",
  },
  body: {
    src: bodyShot,
    alt: "Body measurements: bodyweight at 84.2 kg with its trend and weekly rate, and the body fat, lean mass and BMI derived from it",
    caption: "Body",
  },
  profile: {
    src: profileShot,
    alt: "The profile tab: 1,646,444 kg lifted over 179 sessions, above an account that is optional and signed out",
    caption: "Profile",
  },
} as const satisfies Record<string, Screen>;
