import { Phone } from "@/components/site/phone";
import { Reveal } from "@/components/site/reveal";
import { screens, type Screen } from "@/lib/screens";
import { cn } from "@/lib/utils";

/*
 * An opening spread, then three rows, and no two of them the same shape.
 *
 * The spread is the fix for a specific failure: the logging screen deserves the
 * largest device on the page, but a 730px-tall phone beside two hundred pixels
 * of centred copy leaves a quarter of a screen of nothing above and below the
 * text. So the section's own headline moves into that column. The heading, the
 * standfirst and the first feature all sit beside the device, which fills the
 * measure honestly rather than by padding it, and the section opens on its best
 * screen instead of on a heading with a gap under it.
 *
 * The three rows below then alternate, with the statistics row pairing two
 * devices because the body map and the per-muscle breakdown are one idea shown
 * twice. Alternating is a fine rhythm and a fatal pattern; the pair is what
 * keeps it from becoming one.
 *
 * Two repeated devices came out of every row rather than went in: a mono
 * caption that restated the screen's own title, and a lime-dot footnote under
 * all four. Fine once. Four times down a column they stop being detail and
 * become wallpaper, which is most of what makes a page read as assembled rather
 * than written.
 */
interface Feature {
  screen: Screen;
  /** A second device beside the first. Changes the whole row. */
  companion?: Screen;
  title: string;
  body: string;
}

const OPENING: Feature = {
  screen: screens.activeWorkout,
  title: "The set is the unit of work.",
  body: "Weight, reps, done. Last session's numbers sit beside every row so you know what you are chasing, and checking a set off starts the rest timer without moving anything else on the screen. Nothing happens between the rep and the record.",
};

const FEATURES: Feature[] = [
  {
    screen: screens.restTimer,
    title: "Rest is a deadline, not a stopwatch.",
    body: "The countdown carries on in your notification shade whether or not the app is open, and it stays right even if you swipe the app away. Adding fifteen seconds moves one number rather than nudging two clocks back into step.",
  },
  {
    screen: screens.statistics,
    companion: screens.historyMuscles,
    title: "Where the volume actually went.",
    body: "Weekly sets per muscle, drawn on the figure instead of listed in a table, shaded against the range each one actually grows in. Warm-up sets are left out here and everywhere else, because counting them would inflate every number on the screen.",
  },
  {
    screen: screens.calendar,
    title: "Every session you have logged.",
    body: "Months shaded day by day against your own typical session, quarters charted back to your first workout, personal records marked where they happened. It is the same log you were just writing to, so there is nothing to refresh.",
  },
];

/* No `home` here: it is the hero's device, and the rail is what the tour has
   not shown yet. */
const RAIL: Screen[] = [
  screens.workout,
  screens.exercises,
  screens.history,
  screens.body,
  screens.profile,
];

export function Screens() {
  return (
    <section id="screens" className="border-b border-line py-24 sm:py-32">
      <div className="shell">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-24">
          <div>
            <h2 className="display max-w-[20ch] text-[clamp(2.2rem,5.2vw,4.25rem)]">
              Built for one hand, standing up, mid set.
            </h2>
            <p className="mt-7 max-w-[56ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
              Every screen below is a real phone with 184 sessions behind it.
              None of it is a mockup, and none of the numbers were made up for
              the picture.
            </p>

            <div className="mt-11 border-t border-line pt-9 sm:mt-14">
              <h3 className="display text-[clamp(1.5rem,2.7vw,2rem)]">
                {OPENING.title}
              </h3>
              <p className="mt-4 max-w-[52ch] leading-[1.7] text-fg-2">
                {OPENING.body}
              </p>
            </div>
          </div>

          <div className="relative flex justify-center lg:justify-end">
            {/* The one screen glow on the page. Applied to all eight devices it
                stopped reading as light and started reading as a filter. */}
            <div
              aria-hidden
              className="screen-cast pointer-events-none absolute -inset-x-[35%] -inset-y-[14%]"
            />
            <Phone
              screen={OPENING.screen}
              size="lg"
              className="relative"
              sizes="(max-width: 1024px) 60vw, 336px"
            />
          </div>
        </div>

        <div className="mt-24 space-y-24 sm:mt-28 sm:space-y-28">
          {FEATURES.map((feature, i) => (
            <Reveal
              as="article"
              key={feature.title}
              className={cn(
                "grid items-center gap-12",
                feature.companion
                  ? "lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20"
                  : "lg:grid-cols-2 lg:gap-16",
              )}
            >
              {/*
                The device is pushed toward the copy rather than centred in its
                half. Centred, a 250px phone in a 600px column leaves 175px of
                nothing on the inside edge and the pair stops reading as one
                thing.
              */}
              <div
                className={cn(
                  "relative flex items-center justify-center gap-4 sm:gap-6",
                  i % 2 === 1
                    ? "lg:order-2 lg:justify-start"
                    : "lg:justify-end",
                  feature.companion && "lg:order-2 lg:justify-start",
                )}
              >
                <Phone
                  screen={feature.screen}
                  size={feature.companion ? "pair" : "md"}
                  sizes={
                    feature.companion
                      ? "(max-width: 640px) 40vw, 208px"
                      : "(max-width: 1024px) 55vw, 248px"
                  }
                />
                {feature.companion ? (
                  <Phone
                    screen={feature.companion}
                    size="pair"
                    sizes="(max-width: 640px) 40vw, 208px"
                  />
                ) : null}
              </div>

              <div
                className={cn(
                  (i % 2 === 1 || feature.companion) && "lg:order-1",
                )}
              >
                <h3 className="display text-[clamp(1.5rem,2.7vw,2rem)] text-balance">
                  {feature.title}
                </h3>
                <p className="mt-5 max-w-[54ch] leading-[1.7] text-fg-2">
                  {feature.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-28 sm:mt-32">
          <p className="max-w-[46ch] text-fg-3">
            The rest of it: routines, the exercise library, bodyweight and
            measurements, and everything the profile tab reaches.
          </p>

          {/*
            `scroll-pl-*` has to match `px-*`, and leaving it out is not a
            cosmetic miss. A snap container's snapport starts at its padding
            box, so `snap-start` on the first item scrolls the rail right by
            exactly the padding: the leading phone and its caption end up flush
            against the screen edge with the gutter eaten.
          */}
          <ul className="rail mt-8 -mx-5 flex snap-x snap-mandatory scroll-pl-5 gap-5 overflow-x-auto px-5 pb-5 sm:-mx-8 sm:scroll-pl-8 sm:px-8 lg:-mx-12 lg:scroll-pl-12 lg:px-12">
            {RAIL.map((screen) => (
              <li key={screen.src} className="snap-start">
                <Phone screen={screen} size="sm" sizes="152px" />
                <p className="mt-3 text-sm text-fg-3">{screen.caption}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
