import { Reveal } from "@/components/site/reveal";

/*
 * Two doors, so two columns, and the headline sits between them rather than
 * above the pair.
 *
 * No devices here any more. The import and export screens are both a list of
 * what a file holds, which is the one kind of screen a 232px phone frame turns
 * into grey lines: they were the two shots on the page you had to already know
 * to read. Set as text under a rule each, the pair still says what it was
 * there to say, which is that in and out were built at the same time and
 * neither is the afterthought.
 */
const HALVES = [
  {
    title: "Moving in",
    body: "Point it at a Hevy CSV, a Lyfta export, a backup from another phone, or any CSV at all that has a date, an exercise and a set in it. Nothing is written until you say so, and importing the same file twice adds nothing the second time.",
  },
  {
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

        <div className="mt-14 grid gap-12 sm:mt-16 lg:grid-cols-2 lg:gap-20">
          {HALVES.map((half, i) => (
            <Reveal
              key={half.title}
              delay={i * 90}
              className="border-t border-line pt-8"
            >
              <h3 className="display text-[clamp(1.4rem,2.4vw,1.9rem)]">
                {half.title}
              </h3>
              <p className="mt-4 max-w-[48ch] leading-[1.7] text-fg-2">
                {half.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
