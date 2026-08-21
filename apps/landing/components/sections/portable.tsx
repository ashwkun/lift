import { Phone } from "@/components/site/phone";
import { Reveal } from "@/components/site/reveal";
import { screens, type Screen } from "@/lib/screens";

/*
 * Two doors, so two columns, and the headline sits between them rather than
 * above the pair. The devices are side by side at the same size because that is
 * the argument: in and out were built at the same time and neither is the
 * afterthought.
 */
const HALVES: { screen: Screen; title: string; body: string }[] = [
  {
    screen: screens.import,
    title: "Moving in",
    body: "Point it at a Hevy CSV, a Lyfta export, a backup from another phone, or any CSV at all that has a date, an exercise and a set in it. Nothing is written until you say so, and importing the same file twice adds nothing the second time.",
  },
  {
    screen: screens.backup,
    title: "Moving out",
    body: "One file holding every workout, set, routine, record and measurement on the phone. Writing it only reads, so it still works on a day when something else is failing. There is a row-per-set spreadsheet export as well.",
  },
];

export function Portable() {
  return (
    <section className="border-b border-line py-24 sm:py-28">
      <div className="shell">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end lg:gap-20">
          <h2 className="display text-[clamp(1.9rem,4vw,3.1rem)]">
            A training log you can carry out the door.
          </h2>
          <p className="max-w-[54ch] leading-[1.7] text-fg-2 lg:pb-2">
            Years of training history is not a thing to hand over on the
            assumption it stays available. Both doors are open, and they were
            built at the same time.
          </p>
        </div>

        <div className="mt-14 grid gap-14 sm:mt-16 lg:grid-cols-2 lg:gap-20">
          {HALVES.map((half, i) => (
            <Reveal
              key={half.title}
              delay={i * 90}
              className="flex flex-col items-start gap-9 sm:flex-row sm:items-center sm:gap-10 lg:flex-col lg:items-start"
            >
              <Phone
                screen={half.screen}
                size="md"
                className="shrink-0"
                sizes="(max-width: 1024px) 45vw, 232px"
              />
              <div>
                <h3 className="display text-[clamp(1.4rem,2.4vw,1.9rem)]">
                  {half.title}
                </h3>
                <p className="mt-4 max-w-[48ch] leading-[1.7] text-fg-2">
                  {half.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
