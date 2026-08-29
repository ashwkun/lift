import { ArrowUpRight } from "lucide-react";

import { KineticHeading } from "@/components/site/kinetic";
import { Reveal } from "@/components/site/reveal";
import { links } from "@/lib/site";

/*
 * The one section on the page that is only prose.
 *
 * It used to be a bordered card with a header strip and four rules across it,
 * which was the third thing on this page built to that exact recipe. Repeating
 * a container is what makes a page read as generated: no reader counts the
 * cards, but they feel the sameness. The subject also does not want a table.
 * "You do not have to sign in" is a reassurance, and reassurances are made of
 * sentences.
 */
export function Sync() {
  return (
    <section
      id="sync"
      className="overflow-x-clip py-24 sm:py-36 lg:py-44"
    >
      <div className="shell">
        <KineticHeading
          top="Sign in"
          bottom="or don’t"
          lede="An account is optional and it stays optional. All it buys is a second copy of the log, and nothing is held back until you ask for one."
        />

        {/*
          One column, capped at a measure. It was two, which was right against
          a 1280 track and is not against 940: halved, each paragraph came out
          at 36 characters, and a two-line sentence set 36 characters wide is a
          newspaper column with the news taken out.
        */}
        <Reveal className="mt-16 max-w-[46rem] sm:mt-20">
          <div className="space-y-6 text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
            <p>
              Signing in adds a backup and the same log on a second phone. It adds
              nothing else and it is not a tier. Workouts are written on the
              phone and sent afterwards, so losing signal mid session changes
              nothing, and a sync cut off halfway is picked up by the next one
              rather than handing you the same workout twice.
            </p>
            <p>
              Edit the same session in two places and the most recent edit is the
              one that keeps. Delete it on one phone and it goes on the other.
              Nothing stops working if you never sign in: not a trial, not a
              screen waiting behind a login. Where that second copy sits is the
              next thing on this page.
            </p>
          </div>

          <a
            href={links.readme}
            className="underline-draw mt-10 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-volt"
          >
            How the syncing works underneath
            <ArrowUpRight className="size-4" />
          </a>
        </Reveal>
      </div>
    </section>
  );
}
