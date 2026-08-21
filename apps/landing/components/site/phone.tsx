import Image from "next/image";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type Screen } from "@/lib/screens";

/*
 * A device frame, deliberately generic.
 *
 * No notch, no camera cutout, no branded silhouette. The screenshots are off an
 * Android phone and the app runs on any of them, so a frame that claims a
 * particular handset would be the one dishonest thing on the page. What the
 * frame is actually for: the screens are true black at the edges, and against a
 * true black canvas they would have no boundary at all.
 */
const frame = cva(
  "relative shrink-0 bg-surface-3 ring-1 ring-line-strong ring-inset",
  {
    variants: {
      size: {
        lg: "w-[clamp(14rem,30vw,21rem)] rounded-[2.35rem] p-[0.4rem]",
        md: "w-[clamp(12rem,24vw,15.5rem)] rounded-[2rem] p-[0.34rem]",
        /*
         * Two of these sit side by side in one feature row, so the width has to
         * fall far enough for a pair plus a gap to clear a 360px phone. `md`
         * bottoms out at 12rem, which two of would overflow by fifty pixels.
         */
        pair: "w-[clamp(8rem,19vw,13rem)] rounded-[1.75rem] p-[0.3rem]",
        sm: "w-[9.5rem] rounded-[1.5rem] p-[0.26rem]",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const inner = cva("block h-auto w-full bg-ink object-cover", {
  variants: {
    size: {
      lg: "rounded-[2rem]",
      md: "rounded-[1.7rem]",
      pair: "rounded-[1.5rem]",
      sm: "rounded-[1.28rem]",
    },
  },
  defaultVariants: { size: "md" },
});

interface PhoneProps extends VariantProps<typeof frame> {
  screen: Screen;
  className?: string;
  priority?: boolean;
  /** Rendered width hint for the image optimiser, in CSS pixels. */
  sizes?: string;
}

export function Phone({
  screen,
  size = "md",
  className,
  priority = false,
  sizes = "(max-width: 768px) 60vw, 320px",
}: PhoneProps) {
  return (
    <div className={cn(frame({ size }), className)}>
      <Image
        src={screen.src}
        alt={screen.alt}
        width={SCREEN_WIDTH}
        height={SCREEN_HEIGHT}
        sizes={sizes}
        priority={priority}
        quality={88}
        className={inner({ size })}
      />
    </div>
  );
}
