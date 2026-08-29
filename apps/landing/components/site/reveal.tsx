"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/*
 * Fade and rise a block the first time it comes into view.
 *
 * Three constraints, all inherited from the app this page is selling.
 *
 * Only `opacity` and `transform` move. Animating anything the layout depends on
 * hands the compositor work it has to do on the main thread instead.
 *
 * Reduced motion is not a softened version of the animation, it is the absence
 * of one. The app gates every celebration it has behind `useReduceMotion`, and
 * a marketing page has considerably less to celebrate.
 *
 * And the visible state lives on the DOM node rather than in React state. There
 * is nothing here for a re-render to compute: the observer fires once, sets one
 * attribute, and disconnects. Content that re-animates every time it scrolls
 * past reads as a page that cannot settle.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  /** Stagger, in milliseconds. Past roughly 200 a group stops reading as one. */
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
}) {
  /*
   * Widened to `ElementType` on purpose. A union of intrinsic tags makes the
   * `ref` prop resolve to an *intersection* of the per-tag ref types, which
   * nothing can satisfy. The runtime value is one of four strings either way.
   */
  const Tag = as as React.ElementType;
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const show = () => {
      el.dataset.shown = "";
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      show();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        show();
        observer.disconnect();
      },
      /*
       * A fixed inset rather than a percentage. `-10%` is measured against the
       * root's height, so the same rule waits 90px into a phone and 200px into
       * a large monitor, and the taller the window the later anything appears.
       * 72px is the same distance everywhere.
       */
      { rootMargin: "0px 0px -72px 0px", threshold: 0.05 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      data-reveal=""
      style={{ transitionDelay: `${delay}ms` }}
      /*
       * A second flat, up from 700ms, to sit with the scrubbed effects in
       * `scroll-motion.tsx` rather than against them. This is the only piece of
       * motion on the page a stopwatch applies to, so it is also the one that
       * gives the pace away: a paragraph that lands while the title above it is
       * still arriving reads as two systems, and it was the faster of the two.
       *
       * `ease-out-quint` is doing the elegance and it did not need touching.
       * Nearly all of a quint's travel is over in the first third, so the extra
       * 300ms is spent on the settle rather than on the movement, which is the
       * difference between a slow animation and a long one.
       */
      className={cn(
        "translate-y-4 opacity-0 transition-[opacity,transform] duration-1000 ease-[var(--ease-out-quint)]",
        "data-shown:translate-y-0 data-shown:opacity-100",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
