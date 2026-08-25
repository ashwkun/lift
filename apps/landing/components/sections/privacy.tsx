import { ArrowUpRight } from "lucide-react";

import { Reveal } from "@/components/site/reveal";
import { links } from "@/lib/site";
import { cn } from "@/lib/utils";

/*
 * The egress ledger: everything the app is capable of sending, and where each
 * one goes.
 *
 * Set as a ledger rather than as a list of assurances, because the two read
 * differently even when they say the same thing. "We respect your privacy" is a
 * claim about intentions and there is no version of it a reader can check. Four
 * rows naming what leaves, where it lands and what it contains is a statement
 * that can be held against the source, which is the only kind this page is
 * interested in making.
 *
 * The third row is why the section works. An app that listed three good answers
 * and quietly left out the update check would be doing the thing the rest of
 * this page argues it does not do; naming it, in the same type as
 * the others, is what makes the other three worth believing. It is also true
 * that it is the only one: `apps/mobile/package.json` has no analytics SDK, no
 * crash reporter and no advertising id in it, and `expo-updates` is the sole
 * dependency in that file that talks to a machine this project does not own.
 *
 * Keep the tones as they are. The accent lands on `Nowhere` and on nothing else
 * in this section, because that is the row the page is actually about.
 */
const EGRESS = [
  {
    event: "Every workout, set, routine, record and measurement",
    destination: "Nowhere",
    tone: "text-volt",
    note: "Written to a database on the phone and read back from the same place. With no account and no backup, uninstalling the app is the end of it, because there was never a second copy anywhere to go looking for.",
  },
  {
    event: "A sync, once you have decided to sign in",
    destination: "Your server",
    tone: "text-fg",
    note: "The same rows, over HTTPS, to whichever address the build was pointed at. The server behind that address is in this repository under the same licence, so it can be a machine you own. Nothing is sent before you sign in, and signing out stops it.",
  },
  {
    event: "An update check, each time the app starts",
    destination: "Expo",
    tone: "text-fg-3",
    note: "It asks whether a newer JavaScript bundle exists for this exact build, and downloads one if there is. Nothing about your training goes with the question. It is the only thing the app sends on its own initiative to a machine that is not yours, and it is the reason a fix can reach you without another install.",
  },
  {
    event: "A backup, a spreadsheet, or a file for a coach",
    destination: "You decide",
    tone: "text-fg",
    note: "Every export is a file handed to the share sheet, and the share sheet is you choosing. Nothing is uploaded on your behalf first. Send it nowhere and it stays on the phone with everything else.",
  },
];

export function Privacy() {
  return (
    <section id="privacy" className="border-b border-line py-24 sm:py-32">
      <div className="shell">
        <div className="max-w-[44rem]">
          <h2 className="display text-[clamp(2rem,4.4vw,3.5rem)]">
            Nothing leaves the phone that you did not send
            <span className="text-volt">.</span>
          </h2>
          <p className="mt-7 max-w-[56ch] text-[1.0625rem] leading-[1.7] text-fg-2 sm:text-lg">
            Local-first says where your training lives. This is the other half
            of it: everything the app can send, where each one goes, and what is
            in it. Four rows, and there is no fifth.
          </p>
        </div>

        {/*
          One rule above the first row and one under each, so the ledger opens
          on a line rather than on a heading with air under it. The destination
          sits on the same baseline as the thing it answers and is set in the
          mono, which is what stops the column reading as four more paragraphs.
        */}
        <Reveal className="mt-14 border-t border-line sm:mt-16">
          <ul>
            {EGRESS.map((row) => (
              <li
                key={row.destination}
                className="grid items-baseline gap-x-10 gap-y-3 border-b border-line py-8 sm:grid-cols-[minmax(0,1fr)_auto] sm:py-9"
              >
                <p className="max-w-[38ch] text-[1.0625rem] leading-[1.4] font-semibold text-fg sm:text-lg">
                  {row.event}
                </p>
                <p
                  className={cn(
                    "figure text-[0.9375rem] tracking-[0.08em] uppercase sm:text-right sm:text-base",
                    row.tone,
                  )}
                >
                  {row.destination}
                </p>
                <p className="max-w-[76ch] text-[0.9375rem] leading-[1.75] text-fg-2 sm:col-span-2">
                  {row.note}
                </p>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal
          delay={90}
          className="mt-14 grid gap-8 text-[1.0625rem] leading-[1.75] text-fg-2 sm:mt-16 sm:grid-cols-2 sm:gap-14"
        >
          <p>
            There is no analytics in the build, no crash reporter, no
            advertising id and no session recording. None of that is a promise
            about how the project intends to behave. It is the dependency list,
            and the dependency list is a file in the repository that anybody can
            open and read to the end in about a minute.
          </p>
          <p>
            The licence closes the other end. Lift is AGPL-3.0, so a future
            version that started collecting things would have to publish the
            code that collects them, and the copy already on your phone keeps
            working whatever a future version decides to do. Nothing here
            expires, phones home for permission, or stops at a paywall.
          </p>
        </Reveal>

        <div className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
          <a
            href={links.dependencies}
            className="underline-draw inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-volt"
          >
            Everything the app depends on
            <ArrowUpRight className="size-4" />
          </a>
          <a
            href={links.updates}
            className="underline-draw inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-fg-2 transition-colors hover:text-fg"
          >
            How the update check works
            <ArrowUpRight className="size-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
