import { Reveal } from "@/components/site/reveal";

/*
 * The two parts of the app that say something rather than record something,
 * and the one section on the page with no device in it.
 *
 * Deliberate on both counts: these are the newest features and there are no
 * screenshots of them yet, and a fifth phone-beside-paragraph in a row is where
 * a tour turns into a template.
 *
 * The two halves are also drawn differently on purpose. The left one is a
 * bordered panel because it is quoting a control out of the app, and that is
 * the only borrowed interface on the page. The right one is bare text on the
 * canvas, hanging indents and all, because it is quoting a *document*. Giving
 * them the same card would have said they were the same kind of thing.
 *
 * Neither is invented: `writeReason` in `packages/shared/src/progression.ts`
 * produces exactly those four sentences, and the outline is the heading
 * sequence `packages/shared/src/coach.ts` writes.
 */
const SUGGESTIONS = [
  {
    kind: "Add weight",
    tone: "text-volt",
    target: "82.5 kg × 5",
    reason: "Cleared 8 reps on every set",
  },
  {
    kind: "Add reps",
    tone: "text-signal",
    target: "80 kg × 7",
    reason: "Two of three sets cleared 8",
  },
  {
    kind: "Hold",
    tone: "text-fg-3",
    target: "80 kg × 6",
    reason: "Short of 5 reps, repeat this weight",
  },
  {
    kind: "Back off",
    tone: "text-warn",
    target: "72.5 kg × 5",
    reason: "Short of 5 reps for three sessions, take 10% off",
  },
];

const OUTLINE = [
  { heading: "About me", note: "and anything you want to add" },
  { heading: "The window", note: "how far back it looked" },
  { heading: "Weekly sets per muscle", note: "against where growth starts" },
  { heading: "Session log", note: "every set, with dates" },
  { heading: "Routines", note: "so it can suggest edits" },
  { heading: "Current personal bests", note: null },
];

export function Opinion() {
  return (
    <section id="coach" className="border-b border-line py-24 sm:py-32">
      <div className="shell">
        <p className="text-fg-3">New in this release</p>
        <h2 className="display mt-4 max-w-[25ch] text-[clamp(2rem,4.6vw,3.5rem)]">
          Most of it just writes down what you did. Two parts read it back.
        </h2>

        <div className="mt-16 grid gap-16 sm:mt-20 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <h3 className="display text-[clamp(1.5rem,2.7vw,2rem)]">
              What to lift next.
            </h3>
            <p className="mt-5 max-w-[52ch] leading-[1.7] text-fg-2">
              Every exercise carries the weight and the reps to beat, worked out
              from your own last few sessions rather than from a program. Clear
              the top of your rep range and it asks for load. Fall short three
              sessions running and it takes some off. Tap the line to fill the
              set, or ignore it and nothing happens.
            </p>

            <div className="mt-9 overflow-hidden rounded-xl border border-line bg-surface">
              <ul className="divide-y divide-line">
                {SUGGESTIONS.map((row) => (
                  <li
                    key={row.kind}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 px-5 py-4"
                  >
                    <span className={`label w-24 shrink-0 ${row.tone}`}>
                      {row.kind}
                    </span>
                    <span className="figure text-[0.9375rem] font-medium text-fg">
                      {row.target}
                    </span>
                    {/*
                      Below `sm` the reason takes its own line at full width
                      instead of being pushed right by `ml-auto`, where wrapped
                      and right-aligned it reads as a caption belonging to the
                      row underneath it.
                    */}
                    <span className="basis-full pl-28 text-[0.8125rem] text-fg-3 sm:ml-auto sm:basis-auto sm:pl-0">
                      {row.reason}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={90}>
            <h3 className="display text-[clamp(1.5rem,2.7vw,2rem)] text-balance">
              A second opinion, from whatever model you already use.
            </h3>
            <p className="mt-5 max-w-[52ch] leading-[1.7] text-fg-2">
              Lift writes your training out as one document: the sessions as you
              did them, the weekly sets each muscle got against where growth
              actually starts, and the routines behind all of it. Add a line
              about your goal, or the shoulder that clicks on incline press,
              then hand the file to ChatGPT or Claude and read what comes back.
              The app sends nothing anywhere. You share the file.
            </p>

            {/*
              A document, set as one: a filename, a rule, and headings on a
              hanging indent. No panel, because the thing it is quoting is not
              part of the interface.
            */}
            <figure className="mt-9">
              <figcaption className="figure border-b border-line pb-3 text-[0.8125rem] text-fg-3">
                training-review.md
              </figcaption>
              <ul className="mt-5 space-y-3">
                {OUTLINE.map((row) => (
                  <li key={row.heading} className="flex gap-3">
                    <span className="figure shrink-0 pt-0.5 text-[0.8125rem] text-volt/60">
                      ##
                    </span>
                    <span className="text-[1.0625rem] text-fg">
                      {row.heading}
                      {row.note ? (
                        <span className="block text-[0.9375rem] text-fg-3 sm:ml-3 sm:inline">
                          {row.note}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </figure>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
