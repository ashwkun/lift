import { Download } from "lucide-react";

import { GitHubMark } from "@/components/site/icons";
import { LinkButton } from "@/components/site/link-button";
import { Phone } from "@/components/site/phone";
import { screens } from "@/lib/screens";
import type { Release } from "@/lib/release";
import { links } from "@/lib/site";

/*
 * Hidden below `sm`, because below `sm` there is no row for it to divide.
 *
 * The four facts are about 350px of tracked-out mono and a 375pt phone offers
 * 335, so the row wrapped, and a flex row that wraps breaks wherever it runs
 * out: the tick before "Self-hostable" ended the first line, leaving a rule
 * hanging off the end of it with nothing on the other side. Below `sm` the
 * facts are set as a 2x2 grid instead and divide themselves.
 */
function Tick() {
  return (
    <span
      aria-hidden
      className="hidden h-3 w-px shrink-0 bg-line-strong sm:block"
    />
  );
}

export function Hero({ release }: { release: Release | null }) {
  return (
    <section id="top" data-hero className="relative overflow-x-clip">
      {/*
        One column, and the device stands under the type rather than beside it.
        It was a two-track grid at `lg`, which was the right shape against a
        1280 measure and is not against 940: the headline and a 296px phone
        cannot both have the width they want out of 844, so the headline lost
        and came out at two thirds the size it is set at here. Stacked, the
        type gets the whole track and the device gets a row of its own with
        nothing to compete with.
      */}
      <div className="shell pt-14 pb-16 sm:pt-20 sm:pb-20 lg:pt-24">
        <p
          data-hero-spec
          className="label grid w-fit grid-cols-[auto_auto] gap-x-7 gap-y-2.5 text-fg-3 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-3"
        >
          {/* Dropped entirely when the release could not be read, rather
              than falling back to a number nobody can download. */}
          {release ? (
            <>
              <span className="text-volt">{release.tag}</span>
              <Tick />
            </>
          ) : null}
          <span>Android</span>
          <Tick />
          <span>AGPL-3.0</span>
          <Tick />
          {/* Above the fold because it is half of what the page argues and
              the only fact in this row a reader cannot guess. */}
          <span>Self-hostable</span>
        </p>

        {/*
          The floor is the number that matters: it is what a 390pt screen
          actually gets, and at the 41px this used to be, the headline was
          a heading on a page rather than the first thing in the room.

          The ceiling is set by the measure now the device is out of the
          way. At 100px the three lines run about 650 of the 844 the column
          has, which is the proportion a display headline wants: filling it
          exactly would leave the ragged right edge with nothing to be
          ragged against.

          Still three lines, broken on purpose rather than left to wrap.
          The headline is two sentences and the break after each one is
          where a reader would take a breath anyway; balancing it instead
          leaves a one-word third line, which is the classic display-type
          failure.
        */}
        <h1
          data-hero-heading
          className="display  mt-6 text-[clamp(3rem,9.5vw,6.25rem)] sm:mt-8"
        >
          Log the set.
          <br />
          Get back
          <br />
          to the bar
          <span className="text-volt">.</span>
        </h1>

        {/*
          Two sentences, down from four. The cut sentences were both true
          and both said again further down the page, at length and with the
          evidence attached: the account is the whole of the sync section
          and the server is the whole of the one under it. A hero that
          already contains the argument leaves the reader nothing to scroll
          for.
        */}
        <p
          data-hero-lede
          className="mt-7 max-w-[42ch] text-[1.1875rem] leading-[1.5] text-fg-2 sm:mt-8 sm:max-w-[46ch] sm:text-[1.5rem] sm:leading-[1.45]"
        >
          Every workout, set, routine and record, in a database on the phone in
          your hand. It opens instantly, works with the network off, and never
          asks you to make an account.
        </p>

        {/*
          A stacked pair at full width below `sm`, a row above it. Wrapped,
          the two of them sat as a pair of ragged 200px slabs down the left
          of a phone; at full width they read as the two things you can do
          next, which is what they are.
        */}
        <div
          data-hero-cta
          className="mt-9 grid gap-3 sm:mt-10 sm:flex sm:flex-wrap sm:items-center"
        >
          <LinkButton size="hero" variant="volt" href={links.release}>
            <Download />
            Download the APK
          </LinkButton>
          <LinkButton size="hero" variant="wire" href={links.repo}>
            <GitHubMark />
            Read the source
          </LinkButton>
        </div>

        <p data-hero-note className="mt-6 text-sm leading-relaxed text-fg-3">
          No account, no ads, no trackers, no subscription, nothing to unlock.
        </p>
      </div>

      {/*
        Outside the shell, because the device is the one thing on the page that
        is a picture rather than a column: centring it in the measure would
        hang it off the left third of a wide window for no reason, and it has
        no gutter to keep since nothing sits beside it.

        No bottom padding on the section either. The frame runs to the edge of
        the hero and the tour starts under it, so the first scroll continues a
        picture instead of clearing one.
      */}
      {/* <div data-hero-device className="relative flex justify-center">
        <div
          aria-hidden
          className="screen-cast pointer-events-none absolute -inset-x-[45%] -inset-y-[18%]"
        />

        <Phone
          data-parallax
          size="xl"
          screen={screens.home}
          priority
          sizes="(max-width: 640px) 72vw, 352px"
          className="relative"
        />
      </div> */}
    </section>
  );
}
