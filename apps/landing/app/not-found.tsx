import { Footer } from "@/components/sections/footer";
import { Nav } from "@/components/sections/nav";
import { LinkButton } from "@/components/site/link-button";
import { links } from "@/lib/site";

/*
 * Next ships a built-in 404 with its own inline styles, which on a page whose
 * canvas is true black arrives as a white slab. One route exists here, so this
 * is short, but it does have to be in the same palette as the site it belongs
 * to.
 */
export default function NotFound() {
  return (
    <>
      <Nav />

      <main className="flex flex-1 items-center">
        <div className="shell py-32">
          <p className="label text-fg-3">404</p>
          <h1 className="display mt-6 text-[clamp(2.4rem,6vw,4.5rem)]">
            Nothing logged here
            <span className="text-volt">.</span>
          </h1>
          <p className="mt-6 max-w-[48ch] text-[1.0625rem] leading-relaxed text-fg-2">
            This site is one page. Whatever you were after is either on it or in
            the repository.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <LinkButton size="touch" variant="volt" href="/">
              Back to the start
            </LinkButton>
            <LinkButton size="touch" variant="wire" href={links.repo}>
              Read the source
            </LinkButton>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
