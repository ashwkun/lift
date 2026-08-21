import { type VariantProps } from "class-variance-authority";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * A link that looks like a button, rather than a button pretending to be one.
 *
 * shadcn's `Button` wraps Base UI's, which assumes a native `<button>` and says
 * so out loud when you hand it an anchor through `render`. Every call site on
 * this page is navigation, so none of them wants button semantics: they want an
 * anchor a middle-click opens in a tab, styled by the same `buttonVariants` the
 * real buttons use. This is the shape shadcn documents for exactly that case,
 * and it ships no client JavaScript.
 */
export function LinkButton({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"a"> & VariantProps<typeof buttonVariants>) {
  return (
    <a className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
