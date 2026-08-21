/**
 * The screenshots in `public/screens`, all 1080x2340 off a real phone with a
 * real training log behind them. Nothing here is a mockup, which is the point:
 * the numbers on these screens are 184 sessions of somebody's actual lifting.
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
    alt: "The workout tab, with an empty workout button above three saved routines",
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
    alt: "All time history: 184 workouts, 316 hours, 2,803 sets, charted by quarter",
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
    alt: "Body measurements: bodyweight and trend, left against right for biceps, forearms and thighs",
    caption: "Body",
  },
  profile: {
    src: "/screens/profile.webp",
    alt: "The profile tab showing lifetime volume, session count, and an optional account with pending changes",
    caption: "Profile",
  },
  backup: {
    src: "/screens/backup.webp",
    alt: "Backup and export, listing what the JSON file holds: 204 workouts, 3,266 sets, 571 personal records",
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
