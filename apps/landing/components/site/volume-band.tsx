/*
 * A year of training as the app would shade it.
 *
 * The four fills are not picked to look nice here. They are
 * `mix(surfaceMuted, accent, f)` at f = 0.38 / 0.58 / 0.77 / 0.96, the exact
 * stops `features/analytics/month-grid.tsx` uses, so the band and the app's
 * calendar are the same scale rather than two things that happen to be green.
 *
 * The row is cropped rather than scrolled, and the newest week is pinned to the
 * right edge. On a narrow screen you get however many weeks fit, fading out at
 * the left, which is the honest thing for a strip whose only job is to show a
 * shape. A scrollbar here would invite reading it as data.
 */

/*
 * Weekly volume steps, oldest to newest. Illustrative, and the page says so.
 *
 * Weighted towards the middle two steps on purpose. `intensityStep` puts a week
 * at the median on step 1 and only 1.5x the median or more on step 4, so a real
 * log is mostly the two middle values with the top step showing up a handful of
 * times a year. A band that is all top step is not a heavier year, it is a
 * broken scale, and it reads as one.
 */
const WEEKS = [
  2, 2, 3, 2, 1, 3, 2, 3, 2, 2, 3, 2, 0, 1, 2, 3, 3, 2, 4, 3, 2, 3, 2, 1, 3, 2,
  3, 4, 3, 2, 2, 0, 1, 3, 2, 3, 2, 4, 3, 3, 2, 3, 4, 2, 3, 2, 1, 3, 4, 3, 3, 4,
];

const FILL = [
  "transparent",
  "var(--vol-1)",
  "var(--vol-2)",
  "var(--vol-3)",
  "var(--vol-4)",
];

const CROP = {
  maskImage: "linear-gradient(to right, transparent, #000 9%, #000 100%)",
  WebkitMaskImage: "linear-gradient(to right, transparent, #000 9%, #000 100%)",
} as const;

export function VolumeBand() {
  return (
    <div>
      <div
        className="flex justify-end gap-[clamp(2px,0.34vw,4px)] overflow-hidden"
        style={CROP}
        role="img"
        aria-label="Fifty-two weeks of training, each week shaded by how much volume it carried against a typical week"
      >
        {WEEKS.map((step, week) => (
          <span
            key={week}
            className="size-[clamp(9px,1.5vw,19px)] shrink-0 rounded-[3px] ring-1 ring-line/70 ring-inset"
            style={{ background: FILL[step] }}
          />
        ))}
      </div>

      {/*
        Caption left, legend hard right, so the row spans the same width the
        band above it does. Grouped together at the left they left half the
        section empty and the band read as unfinished rather than cropped.
      */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <p className="max-w-[52ch] text-sm text-fg-3">
          Fifty-two weeks, illustrative. In the app this is your calendar, one
          cell per day, shaded against your own typical session.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-fg-3">Lighter</span>
          <span className="flex gap-1">
            {FILL.slice(1).map((fill) => (
              <span
                key={fill}
                className="h-2.5 w-5 rounded-[2px]"
                style={{ background: fill }}
              />
            ))}
          </span>
          <span className="text-sm text-fg-3">Heavier</span>
        </div>
      </div>
    </div>
  );
}
