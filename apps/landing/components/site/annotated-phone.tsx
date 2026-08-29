import { Phone } from "@/components/site/phone";
import { type Screen } from "@/lib/screens";
import { cn } from "@/lib/utils";

/*
 * A device with hairlines run out to the gutters and a label on the end of
 * each.
 *
 * The point of it is that a screenshot inside a phone frame is, at 300px wide,
 * a picture of some grey lines. A reader who already uses the app can read it
 * and nobody else can, which makes it decoration on a page arguing that the
 * thing is legible mid set. The callouts name what is actually on the glass, at
 * the height it is on the glass, so the screen is doing the explaining rather
 * than the paragraph beside it.
 *
 * The rules draw outward from their own gutter as the device is scrolled into,
 * top to bottom, which is the order somebody reads the screen in anyway. That
 * part is `components/site/scroll-motion.tsx`; everything here renders finished
 * and gets moved back to the start by GSAP, so with no script the whole figure
 * is simply drawn.
 *
 * There used to be a second mode here for a device above the fold, running the
 * page's CSS entrance keyframes instead of a scrub, because a scrubbed rule
 * with no scroll behind it sits at zero width forever. It went when the hero's
 * entrance moved into GSAP: the hero uses a plain `Phone`, so the branch had no
 * caller and neither did the two keyframes it named.
 *
 * Below `lg` the apparatus is dropped and the labels are set as a plain row
 * under the device. There is no width at which a rail, a gap and a label fit
 * either side of a 208px phone on a 375pt screen, and a callout squeezed into
 * 40px is a dash pointing at nothing.
 */
export interface Callout {
  label: string;
  /** Height on the device, as a CSS length or percentage from the top. */
  top: string;
  side: "left" | "right";
}

export function AnnotatedPhone({
  screen,
  callouts,
  size = "lg",
  priority = false,
  sizes,
  className,
  glow = true,
}: {
  screen: Screen;
  callouts: Callout[];
  size?: "lg" | "md";
  priority?: boolean;
  sizes?: string;
  className?: string;
  glow?: boolean;
}) {
  return (
    <div className={cn("annotated w-full", className)}>
      {/*
        `--phone-w` is what the callout rails are measured against. It is set
        here rather than read off the frame because CSS cannot ask an element
        how wide it ended up: both this and `Phone` resolve the same token, so
        there is one clamp and no way for the rail and the glass to disagree.
      */}
      <div
        className="relative flex justify-center"
        style={
          {
            "--phone-w": size === "lg" ? "var(--phone-lg)" : "var(--phone-md)",
          } as React.CSSProperties
        }
      >
        {glow ? (
          <div
            aria-hidden
            className="screen-cast pointer-events-none absolute -inset-x-[38%] -inset-y-[14%]"
          />
        ) : null}

        <Phone
          screen={screen}
          size={size}
          priority={priority}
          sizes={sizes}
          className="relative"
        />

        {/*
          `aria-hidden`, and the labels are not lost by it: every one of them
          restates something the screenshot's own alt text already says, and a
          screen reader that read both would hear the same screen described
          twice. The alt text is the accessible version of this whole figure.
        */}
        <div
          aria-hidden
          data-callouts
          className="hidden lg:block"
        >
          {callouts.map((callout) => (
            <aside
              key={callout.label}
              className={cn(
                "callout",
                callout.side === "left" ? "callout-left" : "callout-right",
              )}
              style={{ top: callout.top }}
            >
              <div data-callout-rule className="callout-rule" />
              <p data-callout-label className="label mt-3 text-fg-3">
                {callout.label}
              </p>
            </aside>
          ))}
        </div>
      </div>

      {/*
        The small-screen version. Not a fallback: it is the same four facts
        without the geometry, which is the part that does not fit.
      */}
      <ul
        aria-hidden
        className="mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 lg:hidden"
      >
        {callouts.map((callout) => (
          <li key={callout.label} className="label text-fg-3">
            {callout.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
