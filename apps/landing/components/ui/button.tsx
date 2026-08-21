import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        /*
         * The one filled control on the page.
         *
         * Its label is `--volt-ink`, a near-black, not white: the lime sits at
         * ~78% relative luminance, so white on top lands near 2:1. The app
         * names a foreground per role colour for exactly this reason and this
         * page inherits the rule rather than re-deriving it.
         */
        volt: "bg-volt text-volt-ink hover:bg-volt-deep",
        /* Outline that answers a cursor by lighting its edge, not its fill. */
        wire: "border-line-strong bg-transparent text-fg hover:border-volt hover:text-volt",
        /*
         * The pair above, inverted, for the one section that is lime rather
         * than black. A lime button on a lime slab has nowhere to go, so the
         * fill and the ground swap and the accent becomes the label.
         */
        ink: "bg-volt-ink text-volt hover:bg-volt-ink/85 focus-visible:ring-volt-ink/40",
        "wire-ink":
          "border-volt-ink/35 bg-transparent text-volt-ink hover:border-volt-ink hover:bg-volt-ink/8 focus-visible:ring-volt-ink/40",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
        /*
         * 44 and 52 px, `controlHeight.md` and `.lg` from the app's token
         * scale. The first is also `MIN_TOUCH_SIZE`; shadcn's own sizes top out
         * at 36, which is a product-UI height that reads as tentative on a
         * page whose primary action is the reason the page exists.
         */
        touch:
          "h-11 gap-2 rounded-lg px-5 text-[0.9375rem] [&_svg:not([class*='size-'])]:size-4",
        hero: "h-13 gap-2.5 rounded-lg px-6 text-base font-semibold [&_svg:not([class*='size-'])]:size-[1.15rem]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
