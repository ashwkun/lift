import { Phone } from "@/components/site/phone";
import { Reveal } from "@/components/site/reveal";
import { screens, type Screen } from "@/lib/screens";
import { cn } from "@/lib/utils";

/*
 * An opening spread, a band of text, then two rows, and no two of them the same
 * shape.
 *
 * The spread is the fix for a specific failure: the logging screen deserves the
 * largest device on the page, but a 730px-tall phone beside two hundred pixels
 * of centred copy leaves a quarter of a screen of nothing above and below the
 * text. So the section's own headline moves into that column. The heading, the
 * standfirst and the first feature all sit beside the device, which fills the
 * measure honestly rather than by padding it, and the section opens on its best
 * screen instead of on a heading with a gap under it.
 *
 * The band under it is the rest timer, and it has no device because there is no
 * screenshot of one in `screenshots/`: the timer is a sheet over a running
 * session rather than a screen the capture script can navigate to. Setting it as
 * two columns of text rather than faking a device is the honest version, and it
 * breaks up the alternation below, which is a fine rhythm and a fatal pattern.
 *
 * Two repeated devices came out of every row rather than went in: a mono
 * caption that restated the screen's own title, and a lime-dot footnote under
 * all four. Fine once. Four times down a column they stop being detail and
 * become wallpaper, which is most of what makes a page read as assembled rather
 * than written.
 */
interface Feature {
  screen: Screen;
  title: string;
  body: string;
}

const OPENING: Feature = {
  screen: screens.activeWorkout,
  title: "The set is the unit of work.",
  body: "Weight, reps, done. Last session's numbers sit beside every row so you know what you are chasing, and checking a set off starts the rest timer without moving anything else on the screen. Nothing happens between the rep and the record.",
};

const TIMER = {
  title: "Rest is a deadline, not a stopwatch.",
  body: "The countdown carries on in your notification shade whether or not the app is open, and it stays right even if you swipe the app away. Adding fifteen seconds moves one number rather than nudging two clocks back into step.",
};

const FEATURES: Feature[] = [
  {
    screen: screens.statistics,
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
  screens.history,
  screens.body,
  screens.profile,
];

/*
 * `overflow-x-clip` on the section, and it is load-bearing. The `screen-cast`
 * glow below is an absolutely positioned box inset by -35% of the device's
 * width, which at every viewport under 1920 put its right edge past the
 * document: 97px of sideways scroll on a 375pt phone, 214px at 768. A
 * decorative gradient was widening the page and taking the whole layout with
 * it.
 *
 * `clip` rather than `hidden` because hidden on one axis forces the other to
 * scroll, and this section is tall enough that a nested scroll container is a
 * real hazard. The hero clips the same glow with its own `overflow-hidden`,
 * which is why only this one ever escaped.
 */
export function Screens() {
  return (
    <section
      id="screens"
      className="overflow-x-clip border-b border-line py-24 sm:py-32"
    >
      <div className="shell">
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-24">
          <div>
            <h2 className="display max-w-[20ch] text-[clamp(2.2rem,5.2vw,4.25rem)]">
              Built for one hand, standing up, mid set.
            </h2>
            <p className="mt-7 max-w-[56ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
              Every screen below is the app itself, with a year of training
              behind it: 179 sessions, 1,646,444 kg. None of it is a mockup, and
              every figure on them was computed by the app rather than typed
              into the picture.
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
            {/* The one screen glow on the page. Applied to all the devices it
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

        {/*
          Heading left, body right, both on one rule. The only row in the
          section that is text the whole way across, which is what stops the two
          device rows under it from reading as a template.
        */}
        <Reveal
          as="article"
          className="mt-24 border-t border-line pt-12 sm:mt-28 sm:pt-14"
        >
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-12 lg:gap-20">
            <h3 className="display text-[clamp(1.5rem,2.7vw,2rem)] text-balance">
              {TIMER.title}
            </h3>
            <p className="max-w-[54ch] leading-[1.7] text-fg-2">{TIMER.body}</p>
          </div>
        </Reveal>

        <div className="mt-24 space-y-24 sm:mt-28 sm:space-y-28">
          {FEATURES.map((feature, i) => (
            <Reveal
              as="article"
              key={feature.title}
              className={cn(
                "grid items-center gap-10 md:gap-12 lg:grid-cols-2 lg:gap-16",
                /*
                  Between 768 and 1024 the device gets a track exactly its own
                  width rather than half the row. Split down the middle at 768 a
                  192px phone sits in a 328px column and the copy beside it is
                  34ch, which is a newspaper column, not a paragraph; sized to
                  the device it is 48ch. At `lg` there is room for the even
                  split the alternation was drawn around, so it goes back to it.
                */
                i % 2 === 1
                  ? "md:grid-cols-[minmax(0,1fr)_auto]"
                  : "md:grid-cols-[auto_minmax(0,1fr)]",
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
                  "relative flex items-center justify-center",
                  i % 2 === 1
                    ? "md:order-2 lg:justify-start"
                    : "lg:justify-end",
                )}
              >
                <Phone
                  screen={feature.screen}
                  size="md"
                  sizes="(max-width: 1024px) 40vw, 248px"
                />
              </div>

              <div className={cn(i % 2 === 1 && "md:order-1")}>
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
            The rest of it: your routines, the history behind the charts,
            bodyweight and measurements, and everything the profile tab reaches.
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
              <li key={screen.caption} className="snap-start">
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
