/**
 * The screenshots in `public/screens`, all 1080x2340.
 *
 * Nothing here is a mockup, which is the point, but nor is it anybody's real
 * log: `scripts/screenshots/capture.mjs --landing` at the repository root drives
 * the app in a browser against a year generated from a fixed seed, and every
 * figure on these screens is the app's own arithmetic over it. That is a
 * stronger claim than a hand-shot phone was, because it is reproducible: the
 * same command a year from now takes the same set off whatever the app has
 * become.
 *
 * **The keys here are the shot names in `LANDING_SHOTS`.** Renaming one means
 * renaming it there, and an alt text that quotes a number means re-reading that
 * number off the new screen.
 */

export interface Screen {
  src: string;
  alt: string;
  /** Short caption, used where the screen appears without prose beside it. */
  caption: string;
}

export const screens = {
  home: {
    src: "/screens/home.webp",
    alt: "The home tab: volume this week, a twelve week volume chart, and sets by body part over thirty days",
    caption: "Home",
  },
  workout: {
    src: "/screens/workout.webp",
    alt: "The workout tab, with an empty workout button above four saved routines",
    caption: "Routines",
  },
  activeWorkout: {
    src: "/screens/active-workout.webp",
    alt: "A workout in progress: incline bench press with three sets logged against last session's numbers",
    caption: "Active workout",
  },
  restTimer: {
    src: "/screens/rest-timer.webp",
    alt: "The rest timer sheet counting two minutes, with minus fifteen and plus fifteen second controls",
    caption: "Rest timer",
  },
  statistics: {
    src: "/screens/statistics.webp",
    alt: "Statistics: the last seven days, and front and back body figures shaded by weekly sets per muscle",
    caption: "Statistics",
  },
  calendar: {
    src: "/screens/calendar.webp",
    alt: "A month calendar with trained days shaded by volume, above the sessions from that month",
    caption: "Calendar",
  },
  history: {
    src: "/screens/history.webp",
    alt: "All time history: 179 workouts, 221 hours, 3,143 sets, charted by month",
    caption: "History",
  },
  historyMuscles: {
    src: "/screens/history-muscles.webp",
    alt: "Muscles trained over all time, with weekly set counts per muscle against a maintenance target",
    caption: "Muscles trained",
  },
  exercises: {
    src: "/screens/exercises.webp",
    alt: "The exercise library, most trained lifts first, filterable by muscle and equipment",
    caption: "Exercises",
  },
  body: {
    src: "/screens/body.webp",
    alt: "Body measurements: bodyweight with its trend and weekly rate, and the body fat, lean mass and BMI derived from it",
    caption: "Body",
  },
  profile: {
    src: "/screens/profile.webp",
    alt: "The profile tab: lifetime volume, sessions, week streak and active days, above an account that is optional and signed out",
    caption: "Profile",
  },
  backup: {
    src: "/screens/backup.webp",
    alt: "Backup and export, listing what the JSON file holds: workouts, sets, routines, personal records and measurements",
    caption: "Backup",
  },
  import: {
    src: "/screens/import.webp",
    alt: "The import screen offering Hevy, Lyfta, a backup from another phone, or any other CSV",
    caption: "Import",
  },
} as const satisfies Record<string, Screen>;

export const SCREEN_WIDTH = 1080;
export const SCREEN_HEIGHT = 2340;
