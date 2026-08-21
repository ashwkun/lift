import { ArrowUpRight } from "lucide-react";

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
    <section id="sync" className="border-b border-line py-24 sm:py-28">
      <div className="shell">
        <Reveal className="max-w-[62rem]">
          <h2 className="display text-[clamp(1.9rem,4vw,3.1rem)]">
            An account is optional, and it stays optional.
          </h2>

          <div className="mt-9 grid gap-8 text-[1.0625rem] leading-[1.75] text-fg-2 sm:mt-11 sm:grid-cols-2 sm:gap-12">
            <p>
              Signing in adds a backup and the same log on a second phone. It
              adds nothing else, it is not a tier, and nothing is held back
              until you do it. Workouts are written on the phone and sent
              afterwards, so losing signal in the middle of a session changes
              nothing about how the app behaves, and a sync cut off halfway is
              picked up by the next one rather than handing you the same
              workout twice.
            </p>
            <p>
              Edit the same session in two places and the most recent edit is
              the one that keeps. Delete it on one phone and it goes on the
              other. The server sits in the same repository as the app, under
              the same licence, so you can point the app at your own copy of it,
              use the one that is already running, or never sign in at all and
              lose none of the app.
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
