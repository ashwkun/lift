import { cn } from "@/lib/utils";

/*
 * The Lift mark, drawn from the same geometry as every other brand asset.
 *
 * The numbers below are copied verbatim from the top of
 * `scripts/generate-brand.sh`, which is the single definition the app icons,
 * the splash image, the favicon and the README banner are all rendered from.
 * Duplicating them here rather than importing a checked-in SVG keeps this in
 * step by inspection: if the mark changes, these four rectangles are what
 * changed, and a diff shows it.
 *
 * The seam is the part worth understanding. `plate` and `bar` are the same flat
 * lime and they overlap, so without a gap between them the two shapes merge
 * into an unreadable blob. `halo` is the plate grown by 3.5 units, punched out
 * of the stem-and-bar layer through a mask. That transparent gap is the only
 * thing separating them.
 */
const STEM = { x: 16, y: 8, width: 22, height: 68, rx: 7.5 };
const BAR = { x: 16, y: 54, width: 62, height: 22, rx: 7.5 };
const PLATE = { x: 56, y: 33, width: 24, height: 64, rx: 8.5 };
const HALO = { x: 52.5, y: 29.5, width: 31, height: 71, rx: 12 };

/** The mark's own bounding box, so the SVG ships no padding of its own. */
const BOX = { x: 16, y: 8, width: 64, height: 89 };

interface MarkProps extends React.SVGProps<SVGSVGElement> {
  /**
   * Distinguishes this instance's mask. A page rendering the mark more than
   * once must pass a different value each time: SVG mask references resolve by
   * document id, and duplicates would all point at the first one.
   */
  id?: string;
}

export function Mark({ id = "lift-mark", className, ...props }: MarkProps) {
  const seam = `${id}-seam`;

  return (
    <svg
      viewBox={`${BOX.x} ${BOX.y} ${BOX.width} ${BOX.height}`}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={cn("h-6 w-auto text-volt", className)}
      {...props}
    >
      <defs>
        <mask id={seam} maskUnits="userSpaceOnUse" {...BOX}>
          <rect {...BOX} fill="#fff" />
          <rect {...HALO} fill="#000" />
        </mask>
      </defs>
      <g mask={`url(#${seam})`}>
        <rect {...STEM} />
        <rect {...BAR} />
      </g>
      <rect {...PLATE} />
    </svg>
  );
}

/** Mark plus wordmark, the lockup used in the header and the footer. */
export function Wordmark({
  id,
  className,
  markClassName,
}: {
  id: string;
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark id={id} className={cn("h-6 w-auto", markClassName)} />
      <span className="display text-[1.35rem] leading-none tracking-[-0.045em]">
        Lift
      </span>
    </span>
  );
}
