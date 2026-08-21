"use client";

import { useEffect, useRef } from "react";
import { Download } from "lucide-react";

import { GitHubMark } from "@/components/site/icons";
import { LinkButton } from "@/components/site/link-button";
import { Wordmark } from "@/components/site/mark";
import { links } from "@/lib/site";

/*
 * The header carries a progress rule, and it is borrowed rather than invented:
 * the app puts how much of the workout is left across the top of the workout
 * screen, for the same reason a long page wants it. It is state, not
 * decoration, so reduced motion does not turn it off. What reduced motion does
 * turn off is the browser's smooth scrolling, which is handled globally.
 *
 * Nothing in here re-renders. The scroll handler writes a transform and an
 * attribute straight onto two nodes, and the spy sets `data-active` on a link.
 * Putting a scroll position into React state would re-render the header on
 * every frame of every scroll, which is the one thing this component must not
 * do on a page that is nine thousand pixels long.
 */
const SECTIONS = [
  { id: "screens", label: "Screens" },
  { id: "coach", label: "Coaching" },
  { id: "offline", label: "Offline" },
  { id: "sync", label: "Sync" },
  { id: "get", label: "Install" },
];

export function Nav() {
  const header = useRef<HTMLElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const headerEl = header.current;
    const barEl = bar.current;
    if (!headerEl || !barEl) return;

    let frame = 0;
    const paint = () => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const progress = max > 0 ? Math.min(1, window.scrollY / max) : 0;
      barEl.style.transform = `scaleX(${progress})`;
      // Past the first scroll the header needs an edge; over the hero it does not.
      headerEl.toggleAttribute("data-scrolled", window.scrollY > 24);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(paint);
    };

    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    /*
     * The spy takes whichever section is crossing the middle of the viewport.
     * A default root would mark a section active the moment one pixel of it
     * appears at the bottom, so two links light up at once through every
     * transition.
     */
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          list.current
            ?.querySelectorAll<HTMLAnchorElement>("[data-section]")
            .forEach((link) => {
              link.toggleAttribute("data-active", link.dataset.section === id);
            });
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );

    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer.disconnect();
    };
  }, []);

  return (
    <header
      ref={header}
      className="group/header sticky top-0 z-50 border-b border-transparent bg-ink transition-colors duration-300 data-scrolled:border-line"
    >
      <nav aria-label="Main" className="shell flex h-16 items-center gap-8">
        <a
          href="#top"
          className="rounded-sm text-fg transition-colors hover:text-volt"
        >
          <Wordmark id="mark-nav" />
          <span className="sr-only">Lift, back to top</span>
        </a>

        {/*
          `lg` rather than `md`. Five section links plus Source plus the
          download button do not fit beside the wordmark at 768px without the
          gaps closing to the point where the links read as one word.
        */}
        <ul ref={list} className="ml-auto hidden items-center gap-7 lg:flex">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                data-section={section.id}
                className="underline-draw text-sm text-fg-2 transition-colors hover:text-fg data-active:text-volt"
              >
                {section.label}
              </a>
            </li>
          ))}
          <li>
            <a
              href={links.repo}
              className="underline-draw flex items-center gap-2 text-sm text-fg-2 transition-colors hover:text-fg"
            >
              <GitHubMark className="size-4" />
              Source
            </a>
          </li>
        </ul>

        <LinkButton
          size="touch"
          variant="volt"
          className="ml-auto lg:ml-0"
          href={links.release}
        >
          <Download />
          Get the app
        </LinkButton>
      </nav>

      {/*
        Sits on the header's own bottom edge, one pixel below it, so it reads as
        that rule filling in rather than as a second bar parked under the first.
        The resting state is an inline transform rather than `scale-x-0`:
        Tailwind v4 compiles scale utilities to the standalone `scale` property,
        which composes with `transform` instead of being overridden by it, so
        the class would multiply every painted frame back down to zero.
      */}
      <span
        ref={bar}
        aria-hidden
        style={{ transform: "scaleX(0)" }}
        className="absolute inset-x-0 -bottom-px h-0.5 origin-left bg-volt"
      />
    </header>
  );
}
