import { Footer } from "@/components/sections/footer";
import { Hero } from "@/components/sections/hero";
import { Install } from "@/components/sections/install";
import { Nav } from "@/components/sections/nav";
import { Offline } from "@/components/sections/offline";
import { Opinion } from "@/components/sections/opinion";
import { Portable } from "@/components/sections/portable";
import { Screens } from "@/components/sections/screens";
import { Sync } from "@/components/sections/sync";
import { Reveal } from "@/components/site/reveal";
import { VolumeBand } from "@/components/site/volume-band";
import { latestRelease } from "@/lib/release";

/*
 * Fetched once here and handed down, rather than called in both places that
 * print it. Next would dedupe two identical fetches inside one render anyway,
 * but one call site is one thing to reason about, and it makes it obvious that
 * the hero's version badge and the download button cannot disagree.
 */
export default async function Home() {
  const release = await latestRelease();

  return (
    <>
      <Nav />

      <main className="flex-1">
        <Hero release={release} />

        {/*
          A year of training, between the hero and the tour. It reads as the
          divider it structurally is, and it is the first thing on the page that
          shows what a filled-in log looks like rather than describing one.
        */}
        <section className="border-b border-line py-14 sm:py-16">
          <div className="shell">
            <Reveal>
              <VolumeBand />
            </Reveal>
          </div>
        </section>

        <Screens />
        <Opinion />
        <Offline />
        <Portable />
        <Sync />
        <Install release={release} />
      </main>

      <Footer />
    </>
  );
}
