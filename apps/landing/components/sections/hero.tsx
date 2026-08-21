import { Download } from "lucide-react";

import { GitHubMark } from "@/components/site/icons";
import { LinkButton } from "@/components/site/link-button";
import { Phone } from "@/components/site/phone";
import { screens } from "@/lib/screens";
import { links, version } from "@/lib/site";

function Tick() {
  return <span aria-hidden className="h-3 w-px shrink-0 bg-line-strong" />;
}

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-line">
      <div className="shell pt-16 pb-20 sm:pt-24 lg:pt-28 lg:pb-28">
        <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
          <div>
            <p
              className="rise label flex flex-wrap items-center gap-3 text-fg-3"
              style={{ animationDelay: "40ms" }}
            >
              <span className="text-volt">v{version}</span>
              <Tick />
              <span>Android</span>
              <Tick />
              <span>AGPL-3.0</span>
            </p>

            {/*
              Three lines, broken on purpose rather than left to wrap. The
              headline is two sentences and the break after each one is where a
              reader would take a breath anyway; balancing it instead leaves a
              one-word third line, which is the classic display-type failure.
            */}
            <h1
              className="rise display mt-7 text-[clamp(2.6rem,7.4vw,6.25rem)]"
              style={{ animationDelay: "110ms" }}
            >
              Log the set.
              <br />
              Get back
              <br />
              to the bar
              <span className="text-volt">.</span>
            </h1>

            <p
              className="rise mt-8 max-w-[58ch] text-[1.0625rem] leading-[1.65] text-fg-2 sm:text-lg"
              style={{ animationDelay: "190ms" }}
            >
              Lift keeps every workout, set, routine and record on the phone in
              your hand. It opens instantly, works with the network off, and
              never asks you to make an account. Signing in is optional, and all
              it adds is a backup and a second device.
            </p>

            <div
              className="rise mt-10 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "270ms" }}
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

            <p
              className="rise mt-6 text-sm leading-relaxed text-fg-3"
              style={{ animationDelay: "340ms" }}
            >
              No account, no ads, no subscription, nothing to unlock.
            </p>
          </div>

          <div
            className="rise relative justify-self-center lg:justify-self-end"
            style={{ animationDelay: "400ms" }}
          >
            <div
              aria-hidden
              className="screen-cast pointer-events-none absolute -inset-x-[45%] -inset-y-[18%]"
            />
            {/*
              Home, not the logging screen. The tour below opens on the logging
              screen because that section is about it, and stacked on a phone
              the two landed within one scroll of each other: the same
              screenshot twice reads as a mistake however good it is. This one
              also carries further at hero size, being charts and bars rather
              than rows of small figures.
            */}
            <Phone
              size="lg"
              screen={screens.home}
              priority
              sizes="(max-width: 1024px) 60vw, 336px"
              className="relative"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
