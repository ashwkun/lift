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

export default function Home() {
  return (
    <>
      <Nav />

      <main className="flex-1">
        <Hero />

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
        <Install />
      </main>

      <Footer />
    </>
  );
}
